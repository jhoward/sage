"""Git sync against real git, in temporary directories.

Nothing is mocked: the promises worth testing are about what ends up in a repository, and
a fake git would only prove the fake. A bare repository on disk stands in for GitHub.
"""

from __future__ import annotations

import os
import subprocess
import time
from pathlib import Path

import pytest

from occam.vault_sync import GitSync, make
from occam.vault_sync import git as git_mod
from occam.vault_sync.git import GitError, describe, unreachable


def git(cwd: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-c", "user.name=T", "-c", "user.email=t@t", *args],
        cwd=cwd, check=True, capture_output=True, text=True,
    ).stdout.strip()


def log(cwd: Path) -> list[str]:
    return git(cwd, "log", "--format=%s").splitlines()


def age(path: Path, seconds: float) -> None:
    """Make a file look as though it was last saved `seconds` ago."""
    then = time.time() - seconds
    os.utime(path, (then, then))


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def vault(tmp_path: Path) -> Path:
    root = tmp_path / "vault"
    root.mkdir()
    (root / "a.md").write_text("# A\n")
    return root


@pytest.fixture
def remote(tmp_path: Path) -> Path:
    bare = tmp_path / "remote.git"
    subprocess.run(["git", "init", "--bare", "-b", "main", str(bare)], check=True, capture_output=True)
    return bare


# ---- local history -----------------------------------------------------

def test_startup_turns_the_vault_into_a_repository(vault: Path):
    status = GitSync(vault).startup()

    assert status.state == "ok"
    assert status.detail == "local history only"
    assert (vault / ".git").is_dir()
    assert "a.md" in git(vault, "ls-files")
    # What was already there is the first commit, not left untracked.
    assert len(log(vault)) == 1


def test_startup_is_safe_to_repeat(vault: Path):
    GitSync(vault).startup()
    GitSync(vault).startup()
    assert len(log(vault)) == 1


def test_a_change_made_while_the_app_was_closed_is_recorded_on_startup(vault: Path):
    GitSync(vault).startup()
    (vault / "a.md").write_text("# A\nedited elsewhere\n")
    GitSync(vault).startup()
    assert log(vault)[0] == "Edit a.md"


def test_a_gitignore_is_written_once_and_never_overwritten(vault: Path):
    GitSync(vault).startup()
    ignore = vault / ".gitignore"
    assert ".occam/keys.md" in ignore.read_text()

    ignore.write_text("mine\n")
    GitSync(vault).startup()
    assert ignore.read_text() == "mine\n"


def test_half_written_files_and_the_key_sheet_stay_out_of_history(vault: Path):
    (vault / ".occam").mkdir()
    (vault / ".occam" / "keys.md").write_text("generated")
    (vault / ".a.md.x1.tmp").write_text("partial")
    GitSync(vault).startup()
    tracked = git(vault, "ls-files")
    assert "keys.md" not in tracked and ".tmp" not in tracked


# ---- committing when you pause, not when you type ----------------------

def test_a_fresh_edit_is_not_committed_mid_typing(vault: Path):
    sync = GitSync(vault, clock=Clock())
    sync.startup()
    (vault / "a.md").write_text("# A\ntyping…\n")

    sync.tick()
    assert len(log(vault)) == 1


def test_an_edit_is_committed_once_the_vault_has_been_quiet(vault: Path):
    sync = GitSync(vault, clock=Clock())
    sync.startup()
    (vault / "a.md").write_text("# A\ndone typing\n")
    age(vault / "a.md", git_mod.QUIET + 1)

    sync.tick()
    assert log(vault)[0] == "Edit a.md"


def test_continuous_editing_is_still_committed_eventually(vault: Path):
    clock = Clock()
    sync = GitSync(vault, clock=clock)
    sync.startup()

    (vault / "a.md").write_text("# A\nstill going\n")
    sync.tick()  # notices the change; too fresh to commit
    assert len(log(vault)) == 1

    clock.now += git_mod.MAX_WAIT + 1
    (vault / "a.md").write_text("# A\nstill going, minutes later\n")  # fresh again
    sync.tick()
    assert len(log(vault)) == 2


def test_shutdown_commits_without_waiting_for_quiet(vault: Path):
    sync = GitSync(vault, clock=Clock())
    sync.startup()
    (vault / "b.md").write_text("new\n")

    sync.shutdown()
    assert log(vault)[0] == "Add b.md"


def test_a_deletion_is_committed(vault: Path):
    sync = GitSync(vault, clock=Clock())
    sync.startup()
    (vault / "a.md").unlink()

    sync.tick()  # a deleted file has no mtime to wait on
    assert log(vault)[0] == "Delete a.md"


def test_status_does_not_run_git(vault: Path, monkeypatch):
    sync = GitSync(vault)
    sync.startup()
    # status() is read on every file save; it has to be free.
    monkeypatch.setattr(sync, "_git", lambda *a, **k: pytest.fail("status() ran git"))
    assert sync.status().state == "ok"


# ---- commit messages ---------------------------------------------------

def test_messages_name_the_file_or_count_them():
    assert describe([(" M", "todo/week.md")]) == "Edit todo/week.md"
    assert describe([("??", "notes/new.md")]) == "Add notes/new.md"
    assert describe([(" D", "old.md")]) == "Delete old.md"

    several = describe([(" M", "b.md"), (" M", "a.md")])
    assert several.splitlines()[0] == "Edit 2 notes"
    assert several.splitlines()[2:] == ["Edit a.md", "Edit b.md"]

    assert describe([(" M", "a.md"), ("??", "b.md")]).startswith("Update 2 notes")


def test_a_note_with_a_non_ascii_name_is_named_as_written(vault: Path):
    sync = GitSync(vault, clock=Clock())
    sync.startup()
    (vault / "café notes.md").write_text("x\n")
    sync.shutdown()
    assert log(vault)[0] == "Add café notes.md"


# ---- a remote ----------------------------------------------------------

def test_startup_pushes_to_the_remote(vault: Path, remote: Path):
    status = GitSync(vault, remote=str(remote)).startup()
    assert status.state == "ok"
    assert log(remote) == log(vault)


def test_a_settled_edit_is_pushed(vault: Path, remote: Path):
    sync = GitSync(vault, remote=str(remote), clock=Clock())
    sync.startup()
    (vault / "a.md").write_text("# A\nmore\n")
    age(vault / "a.md", git_mod.QUIET + 1)

    sync.tick()
    assert log(remote)[0] == "Edit a.md"


def test_a_second_machine_starts_from_what_is_on_the_remote(vault: Path, remote: Path, tmp_path: Path):
    GitSync(vault, remote=str(remote)).startup()

    other = tmp_path / "laptop"
    other.mkdir()
    status = GitSync(other, remote=str(remote)).startup()

    assert status.state == "ok"
    assert (other / "a.md").read_text() == "# A\n"


def test_changes_from_elsewhere_are_brought_in_before_pushing(vault: Path, remote: Path, tmp_path: Path):
    sync = GitSync(vault, remote=str(remote), clock=Clock())
    sync.startup()

    other = tmp_path / "laptop"
    git(tmp_path, "clone", str(remote), str(other))
    (other / "from-laptop.md").write_text("hello\n")
    git(other, "add", "-A")
    git(other, "commit", "-m", "Add from-laptop.md")
    git(other, "push")

    (vault / "a.md").write_text("# A\nlocal edit\n")
    age(vault / "a.md", git_mod.QUIET + 1)
    status = sync.tick()

    assert status.state == "ok"
    assert (vault / "from-laptop.md").exists()
    assert "local edit" in (vault / "a.md").read_text()
    assert log(remote)[0] == "Edit a.md"


def test_a_conflict_is_reported_and_leaves_no_markers_in_the_note(vault: Path, remote: Path, tmp_path: Path):
    sync = GitSync(vault, remote=str(remote), clock=Clock())
    sync.startup()

    other = tmp_path / "laptop"
    git(tmp_path, "clone", str(remote), str(other))
    (other / "a.md").write_text("# A\nthe laptop's version\n")
    git(other, "commit", "-am", "Edit a.md")
    git(other, "push")

    (vault / "a.md").write_text("# A\nthis machine's version\n")
    age(vault / "a.md", git_mod.QUIET + 1)
    status = sync.tick()

    assert status.state == "conflict"
    assert status.conflicts == ["a.md"]
    # The promise: your note is exactly as you left it, and your commit is kept.
    assert (vault / "a.md").read_text() == "# A\nthis machine's version\n"
    assert log(vault)[0] == "Edit a.md"
    assert not (vault / ".git" / "rebase-merge").exists()
    assert not (vault / ".git" / "rebase-apply").exists()


def test_a_standing_conflict_never_touches_the_note_on_disk(vault: Path, remote: Path, tmp_path: Path):
    clock = Clock()
    sync = GitSync(vault, remote=str(remote), clock=clock)
    sync.startup()

    other = tmp_path / "laptop"
    git(tmp_path, "clone", str(remote), str(other))
    (other / "a.md").write_text("# A\nthe laptop's version\n")
    git(other, "commit", "-am", "Edit a.md")
    git(other, "push")

    note = vault / "a.md"
    note.write_text("# A\nthis machine's version\n")
    age(note, git_mod.QUIET + 1)
    assert sync.tick().state == "conflict"

    # The editor has this file open. A retry that started a rebase and aborted it would
    # rewrite the file and put it back — same contents, new inode and mtime.
    before = (note.stat().st_mtime_ns, note.stat().st_ino)
    for _ in range(3):
        clock.now += git_mod.RETRY_EVERY + 1
        assert sync.tick().state == "conflict"
    assert (note.stat().st_mtime_ns, note.stat().st_ino) == before


def test_a_failed_exchange_is_not_retried_on_every_tick(vault: Path, tmp_path: Path, monkeypatch):
    clock = Clock()
    sync = GitSync(vault, remote=str(tmp_path / "nowhere.git"), clock=clock)
    assert sync.startup().state == "error"

    calls = []
    monkeypatch.setattr(sync, "_exchange", lambda: calls.append(clock.now))
    sync.tick()
    clock.now += 15
    sync.tick()
    assert calls == []

    clock.now += git_mod.RETRY_EVERY
    sync.tick()
    assert len(calls) == 1


def test_a_remote_that_is_not_there_is_an_error_and_the_commit_is_still_made(vault: Path, tmp_path: Path):
    sync = GitSync(vault, remote=str(tmp_path / "nowhere.git"), clock=Clock())
    status = sync.startup()

    # Red, not yellow: a repository that does not exist will not start existing.
    assert status.state == "error"
    assert len(log(vault)) == 1  # the work is safe locally regardless


def test_no_network_is_offline_but_a_refused_key_is_an_error():
    for message in (
        "fatal: unable to access 'https://github.com/x/y/': Could not resolve host: github.com",
        "ssh: connect to host github.com port 22: Network is unreachable",
        "ssh: connect to host github.com port 22: Operation timed out",
        "git fetch timed out",
    ):
        assert unreachable(GitError(message, network=True))[0] == "offline", message

    for message in (
        "git@github.com: Permission denied (publickey).",
        "ERROR: Repository not found.",
        "fatal: '/x/nowhere.git' does not appear to be a git repository",
    ):
        state, detail = unreachable(GitError(message, network=True))
        assert state == "error" and detail == message


def test_edits_waiting_for_a_pause_are_pending_then_ok(vault: Path):
    sync = GitSync(vault, clock=Clock())
    sync.startup()
    (vault / "a.md").write_text("# A\ntyping\n")

    assert sync.tick().state == "pending"      # yellow while you type
    age(vault / "a.md", git_mod.QUIET + 1)
    assert sync.tick().state == "ok"           # green once it is committed
    assert log(vault)[0] == "Edit a.md"


def test_an_edit_that_is_undone_stops_being_pending(vault: Path):
    sync = GitSync(vault, clock=Clock())
    sync.startup()
    (vault / "a.md").write_text("# A\ntyping\n")
    assert sync.tick().state == "pending"

    (vault / "a.md").write_text("# A\n")
    assert sync.tick().state == "ok"
    assert len(log(vault)) == 1


def test_pending_does_not_paper_over_a_failure(vault: Path, tmp_path: Path):
    sync = GitSync(vault, remote=str(tmp_path / "nowhere.git"), clock=Clock())
    assert sync.startup().state == "error"
    (vault / "a.md").write_text("# A\nmore\n")
    assert sync.tick().state == "error"        # still red; yellow would be good news


def test_coming_back_online_pushes_what_was_waiting(vault: Path, tmp_path: Path):
    gone = tmp_path / "later.git"
    sync = GitSync(vault, remote=str(gone), clock=Clock())
    assert sync.startup().state == "error"

    subprocess.run(["git", "init", "--bare", "-b", "main", str(gone)], check=True, capture_output=True)
    sync._clock.now += git_mod.RETRY_EVERY + 1
    assert sync.tick().state == "ok"
    assert log(gone) == log(vault)


# ---- refusing to do harm -----------------------------------------------

def test_a_vault_inside_another_repository_is_refused(tmp_path: Path):
    outer = tmp_path / "code"
    outer.mkdir()
    git(outer, "init", "-b", "main")
    (outer / "README.md").write_text("code\n")
    git(outer, "add", "-A")
    git(outer, "commit", "-m", "init")

    inner = outer / "vault"
    inner.mkdir()
    (inner / "note.md").write_text("x\n")

    sync = GitSync(inner, clock=Clock())
    status = sync.startup()

    assert status.state == "error"
    assert "inside another git repository" in status.detail
    # Nothing was committed into the outer repository, then or later.
    sync.tick()
    sync.shutdown()
    assert log(outer) == ["init"]
    assert "vault/note.md" not in git(outer, "ls-files")


def test_make_resolves_the_backend_by_name(vault: Path):
    assert isinstance(make("git", vault, remote="x"), GitSync)
    assert make("git", vault, remote="x").remote == "x"
    assert make("local", vault).backend == "local"
