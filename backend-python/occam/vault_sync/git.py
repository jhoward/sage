"""Git-backed sync: history for every note, and an offsite copy if there is a remote.

The vault is an ordinary git repository. Nothing here is clever — it runs the git you
already have, so the history can be read, repaired or abandoned with tools that will
outlive this app. That is the same bargain the vault itself makes with markdown.

What it promises, in order of importance:

1. **It never hangs.** It runs on a background thread beside an editor. Every call has a
   timeout, and credential, passphrase and GPG prompts are turned off, so a missing SSH
   key is an error in the status line rather than a thread waiting on a terminal nobody
   can see.
2. **It never leaves a note half-merged.** A rebase that conflicts is aborted. Your
   commits stay local, the indicator says which files disagree, and nothing in the vault
   has `<<<<<<<` written into it. Resolving is left to git, by hand; with one person and
   usually one machine this should be rare, and a wrong automatic merge of someone's
   notes is worse than a paused sync.
3. **It commits when you pause, not when you type.** Autosave fires every half second.
   Committing each save would bury the history in noise, so a commit waits until the
   vault has been quiet for a while — or until it has been dirty for long enough that
   waiting any longer would risk real work.

With no remote configured it is local history only, which is still the undo the app did
not have. Add a remote and the same commits are pushed.
"""

from __future__ import annotations

import os
import subprocess
import threading
import time
from pathlib import Path

from .base import SyncStatus

# Seconds the vault must be still before a commit, and the longest a change may wait.
QUIET = 30
MAX_WAIT = 300
# How often to look for commits made elsewhere when there is nothing of ours to push.
FETCH_EVERY = 300
# How long to leave a failed exchange alone. Offline is a normal state for a laptop, and
# retrying on every tick would be a network timeout every fifteen seconds.
RETRY_EVERY = 60

LOCAL_TIMEOUT = 20
NETWORK_TIMEOUT = 45

GITIGNORE = """\
# Written by Occam Notes. Yours to edit.
.DS_Store
# Half-written files from atomic saves; they exist for milliseconds.
.*.tmp
# Generated each time the shortcut sheet is opened.
.occam/keys.md
"""


class GitError(Exception):
    def __init__(self, message: str, *, network: bool = False):
        super().__init__(message)
        self.network = network


class GitSync:
    backend = "git"

    def __init__(self, vault_path, remote: str | None = None, clock=time.monotonic):
        self.root = Path(vault_path)
        self.remote = (remote or "").strip() or None
        self._clock = clock
        self._lock = threading.Lock()
        self._status = SyncStatus(backend=self.backend, state="ok", detail="starting")
        self._dirty_since: float | None = None
        self._last_fetch = 0.0
        self._disabled = False

    # ---- running git ---------------------------------------------------

    def _git(self, *args: str, network: bool = False, check: bool = True) -> str:
        env = {
            **os.environ,
            # Fail rather than ask. Nobody is at a terminal to answer.
            "GIT_TERMINAL_PROMPT": "0",
            "GIT_SSH_COMMAND": os.environ.get("GIT_SSH_COMMAND", "ssh -o BatchMode=yes"),
            "GIT_EDITOR": "true",
            "LC_ALL": "C",
        }
        cmd = [
            "git",
            # A signing prompt would hang a background commit just as a password would.
            "-c", "commit.gpgsign=false",
            # Show paths as they are, not octal-escaped: note names are not always ASCII.
            "-c", "core.quotepath=false",
            *self._identity(),
            *args,
        ]
        try:
            proc = subprocess.run(
                cmd,
                cwd=self.root,
                env=env,
                capture_output=True,
                text=True,
                timeout=NETWORK_TIMEOUT if network else LOCAL_TIMEOUT,
            )
        except subprocess.TimeoutExpired as exc:
            raise GitError(f"git {args[0]} timed out", network=network) from exc
        except FileNotFoundError as exc:
            raise GitError("git is not installed") from exc

        if check and proc.returncode != 0:
            message = (proc.stderr or proc.stdout).strip().splitlines()
            raise GitError(message[-1] if message else f"git {args[0]} failed", network=network)
        return proc.stdout

    _identity_args: list[str] | None = None

    def _identity(self) -> list[str]:
        """Commit as the configured git user, or as the app if there is none.

        Without any identity git refuses to commit at all, and a machine that has never
        been set up for git is exactly where a first backup is most needed.
        """
        if self._identity_args is None:
            probe = subprocess.run(
                ["git", "config", "user.email"], cwd=self.root, capture_output=True, text=True
            )
            self._identity_args = (
                []
                if probe.returncode == 0 and probe.stdout.strip()
                else ["-c", "user.name=Occam Notes", "-c", "user.email=occam@localhost"]
            )
        return self._identity_args

    # ---- the contract --------------------------------------------------

    def startup(self) -> SyncStatus:
        with self._lock:
            try:
                self._prepare()
                # Whatever changed while the app was closed — another editor, a script —
                # is recorded before anything is pulled on top of it.
                self._commit()
                if self.remote:
                    self._exchange()
                else:
                    self._set("ok", "local history only")
            except GitError as exc:
                self._fail(exc)
            return self._status

    def tick(self) -> SyncStatus:
        if self._disabled:
            return self._status
        with self._lock:
            try:
                committed = self._commit_when_settled()
                waited = self._clock() - self._last_fetch
                retry = self._status.state != "ok" and waited >= RETRY_EVERY
                if self.remote and (committed or retry or waited >= FETCH_EVERY):
                    self._exchange()
                elif not self.remote and (committed or self._status.state == "error"):
                    # With a remote, only a successful exchange may clear a bad state:
                    # calling an unreachable remote "ok" between retries would be a lie.
                    self._set("ok", "local history only")
            except GitError as exc:
                self._fail(exc)
            return self._status

    def status(self) -> SyncStatus:
        # Cached on purpose: this is read on every file save, and must not run git.
        return self._status

    def shutdown(self) -> SyncStatus:
        if self._disabled:
            return self._status
        with self._lock:
            try:
                # No waiting for quiet on the way out: this is the last chance.
                if self._commit() and self.remote:
                    self._exchange()
            except GitError as exc:
                self._fail(exc)
            return self._status

    # ---- steps ---------------------------------------------------------

    def _prepare(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)

        inside = self._git("rev-parse", "--show-toplevel", check=False).strip()
        if inside and Path(inside).resolve() != self.root.resolve():
            # Committing here would commit into someone else's repository — the code
            # repo, a dotfiles repo. Refuse, loudly, and do nothing further.
            self._disabled = True
            raise GitError(f"the vault is inside another git repository ({inside})")

        if not inside:
            self._git("init", "-b", "main")

        ignore = self.root / ".gitignore"
        if not ignore.exists():
            ignore.write_text(GITIGNORE)

        if self.remote:
            current = self._git("remote", "get-url", "origin", check=False).strip()
            if not current:
                self._git("remote", "add", "origin", self.remote)
            elif current != self.remote:
                self._git("remote", "set-url", "origin", self.remote)

    def _changes(self) -> list[tuple[str, str]]:
        """(status, path) for everything that differs from the last commit."""
        out = self._git("status", "--porcelain", "-z", "--untracked-files=all")
        entries = [e for e in out.split("\0") if e]
        changes, skip = [], False
        for entry in entries:
            if skip:  # the old name of a rename, which follows its entry
                skip = False
                continue
            code, path = entry[:2], entry[3:]
            skip = "R" in code or "C" in code
            changes.append((code, path))
        return changes

    def _commit_when_settled(self) -> bool:
        changes = self._changes()
        if not changes:
            self._dirty_since = None
            return False

        now = self._clock()
        if self._dirty_since is None:
            self._dirty_since = now

        newest = 0.0
        for _, path in changes:
            try:
                newest = max(newest, (self.root / path).stat().st_mtime)
            except OSError:
                pass  # deleted; a deletion has no mtime to wait on
        still = time.time() - newest >= QUIET
        overdue = now - self._dirty_since >= MAX_WAIT
        if not (still or overdue):
            return False
        return self._commit(changes)

    def _commit(self, changes: list[tuple[str, str]] | None = None) -> bool:
        changes = self._changes() if changes is None else changes
        if not changes:
            return False
        self._git("add", "-A")
        # Staging can come to nothing — a file changed and changed back.
        if not self._git("diff", "--cached", "--name-only").strip():
            self._dirty_since = None
            return False
        self._git("commit", "-m", describe(changes))
        self._dirty_since = None
        return True

    def _exchange(self) -> None:
        """Bring in what is on the remote, then send what is here."""
        self._set("syncing", "")
        self._last_fetch = self._clock()
        try:
            self._git("fetch", "origin", network=True)
        except GitError as exc:
            # Unreachable is a normal state for a laptop, not a failure: the commits are
            # safe locally and go out on a later tick.
            self._set("offline", str(exc))
            return

        branch = self._git("rev-parse", "--abbrev-ref", "HEAD").strip()
        upstream = f"origin/{branch}"
        has_upstream = self._git("rev-parse", "--verify", "-q", upstream, check=False).strip()
        has_commits = self._git("rev-parse", "--verify", "-q", "HEAD", check=False).strip()

        if has_upstream and has_commits:
            behind = self._git("rev-list", "--count", f"HEAD..{upstream}").strip()
            if behind != "0":
                conflicts = self._would_conflict(upstream)
                if not conflicts:
                    # Clean, or git could not say. Either way the rebase is attempted;
                    # only a known conflict is kept away from the working tree.
                    try:
                        self._git("rebase", upstream)
                    except GitError:
                        # Expected only on a git too old to be asked in advance.
                        conflicts = self._git(
                            "diff", "--name-only", "--diff-filter=U", check=False
                        ).split("\n")
                        self._git("rebase", "--abort", check=False)
                if conflicts:
                    self._status = SyncStatus(
                        backend=self.backend,
                        state="conflict",
                        detail="edited here and elsewhere; resolve with git in the vault folder",
                        conflicts=[c for c in conflicts if c],
                    )
                    return
        elif has_upstream and not has_commits:
            self._git("reset", "--hard", upstream)

        if has_commits or has_upstream:
            try:
                self._git("push", "-u", "origin", branch, network=True)
            except GitError as exc:
                self._set("offline" if exc.network else "error", str(exc))
                return
        self._set("ok", "")

    def _would_conflict(self, upstream: str) -> list[str] | None:
        """The files a rebase would conflict on; [] if it is clean; None if git cannot say.

        Asked in advance, with `merge-tree`, because the alternative is to start the
        rebase and abort it — which rewrites files in the working tree and puts them back,
        under an editor that has one of them open, again on every retry for as long as the
        conflict stands. This computes the merge entirely inside git's object store.
        """
        proc = subprocess.run(
            ["git", "merge-tree", "--write-tree", "--name-only", "--no-messages", "HEAD", upstream],
            cwd=self.root, capture_output=True, text=True, timeout=LOCAL_TIMEOUT,
        )
        if proc.returncode == 0:
            return []
        if proc.returncode == 1:
            # First line is the tree; the conflicted paths follow.
            return [line for line in proc.stdout.splitlines()[1:] if line]
        return None  # git older than 2.38 has no --write-tree

    # ---- status --------------------------------------------------------

    def _set(self, state, detail: str) -> None:
        self._status = SyncStatus(backend=self.backend, state=state, detail=detail)

    def _fail(self, exc: GitError) -> None:
        self._set("offline" if exc.network else "error", str(exc))


def describe(changes: list[tuple[str, str]]) -> str:
    """A commit message from what changed. Deterministic: no model, no surprises.

    `git log --oneline` in a vault should read as a diary of what was touched, so the
    subject names the file when there is one and counts them when there are several.
    """

    def verb(code: str) -> str:
        if "D" in code:
            return "Delete"
        if "R" in code:
            return "Rename"
        if "A" in code or "?" in code:
            return "Add"
        return "Edit"

    if len(changes) == 1:
        code, path = changes[0]
        return f"{verb(code)} {path}"

    verbs = {verb(code) for code, _ in changes}
    lead = verbs.pop() if len(verbs) == 1 else "Update"
    subject = f"{lead} {len(changes)} notes"
    body = "\n".join(f"{verb(code)} {path}" for code, path in sorted(changes, key=lambda c: c[1]))
    return f"{subject}\n\n{body}"
