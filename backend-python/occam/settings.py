"""The settings screen's backend: read, validate, apply.

Two rules hold this together.

**The API key is write-only.** It can be set or cleared from the screen, and the screen is
told whether one exists. It is never sent back. The key has stayed in the backend since
the first version, and a settings form is the most natural place for that to slip.

**As little as possible needs a restart.** The key, workspace and names are read from the
live config on every request, and the sync backend is swappable, so those apply at once.
Only the vault path waits for the next launch: every open file and the whole tree hang
off it, and moving it under a running editor is how notes get written to the wrong place.
"""

from __future__ import annotations

import os
import re
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

from . import ai
from . import config as config_mod

SYNC_BACKENDS = ("local", "git")

# What a git remote may look like: scp-style, a URL, or an absolute path.
_REMOTE = re.compile(
    r"^(?:"
    r"[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[A-Za-z0-9._~/-]+"      # git@github.com:you/notes.git
    r"|(?:https?|ssh|git|file)://[^\s]+"                      # https://… ssh://…
    r"|/[^\s]*"                                               # /Volumes/backup/notes.git
    r")$"
)
_GITHUB = re.compile(r"github\.com[:/]+([A-Za-z0-9._-]+)/([A-Za-z0-9._-]+?)(?:\.git)?/?$")


class SettingsError(ValueError):
    pass


def describe(cfg, sync_status: dict | None = None) -> dict:
    """Everything the screen shows. Note what is absent."""
    return {
        "configPath": str(config_mod.CONFIG_PATH),
        "vaultPath": str(cfg.vault_path),
        "sync": cfg.sync,
        "syncRemote": getattr(cfg, "sync_remote", None) or "",
        "apiKeySet": ai.api_key(cfg) is not None,
        # Set in the environment, it wins over the file, and the screen should say so
        # rather than let someone replace a key that is not the one in use.
        "apiKeyFromEnv": bool(os.environ.get("ANTHROPIC_API_KEY")),
        "workspaceId": cfg.anthropic_workspace_id or "",
        "me": list(cfg.me),
        "syncStatus": sync_status,
    }


def clean_remote(value: str) -> str | None:
    """A remote safe to hand to git, or None for "no remote".

    The shape is checked because this string becomes a git argument. One beginning with
    `-` would be read as an option — `--upload-pack=…` runs a command — so anything that
    is not plainly an address is refused rather than escaped.
    """
    value = (value or "").strip()
    if not value:
        return None
    if value.startswith("-") or not _REMOTE.match(value):
        raise SettingsError(
            "That does not look like a git remote. "
            "Expected something like git@github.com:you/notes.git"
        )
    return value


def validate(changes: dict) -> dict[str, object]:
    """Request fields to config fields, or a SettingsError saying what is wrong."""
    out: dict[str, object] = {}

    if "vaultPath" in changes:
        raw = str(changes["vaultPath"]).strip()
        if not raw:
            raise SettingsError("The vault needs a folder.")
        path = Path(raw).expanduser()
        if not path.is_absolute():
            raise SettingsError("The vault folder has to be a full path, like ~/occam.")
        if path.exists() and not path.is_dir():
            raise SettingsError(f"{path} is a file, not a folder.")
        out["vault_path"] = path

    if "sync" in changes:
        if changes["sync"] not in SYNC_BACKENDS:
            raise SettingsError(f"Backup can be one of: {', '.join(SYNC_BACKENDS)}.")
        out["sync"] = changes["sync"]

    if "syncRemote" in changes:
        out["sync_remote"] = clean_remote(str(changes["syncRemote"]))

    # The key: a value sets it, `clearApiKey` removes it, and an empty field means
    # "unchanged" — which is what a write-only field that always starts empty has to mean.
    if changes.get("clearApiKey"):
        out["anthropic_api_key"] = None
    elif str(changes.get("apiKey") or "").strip():
        key = str(changes["apiKey"]).strip()
        if any(c.isspace() for c in key) or '"' in key:
            raise SettingsError("That API key has a space or a quote in it; check the paste.")
        out["anthropic_api_key"] = key

    if "workspaceId" in changes:
        out["anthropic_workspace_id"] = str(changes["workspaceId"]).strip() or None

    if "me" in changes:
        names = changes["me"]
        if not isinstance(names, list):
            raise SettingsError("Names should be a list.")
        out["me"] = [str(n).strip() for n in names if str(n).strip()]

    return out


def needs_restart(applied: dict[str, object]) -> bool:
    return "vault_path" in applied


# ---- checking a remote before trusting it with someone's notes ----------


def github_visibility(remote: str, opener=urllib.request.urlopen) -> str:
    """"public", "private" or "unknown" for a GitHub remote, asked without credentials.

    An anonymous request can see a public repository and cannot see a private one, so a
    200 means anyone can read it. A 404 means private *or* missing, which the caller
    resolves by also checking that the remote answers to git.
    """
    m = _GITHUB.search(remote)
    if not m:
        return "unknown"
    request = urllib.request.Request(
        f"https://github.com/{m.group(1)}/{m.group(2)}", method="HEAD"
    )
    try:
        with opener(request, timeout=6):
            return "public"
    except urllib.error.HTTPError as exc:
        return "private" if exc.code == 404 else "unknown"
    except Exception:  # noqa: BLE001 — offline, DNS, TLS: all mean "could not tell"
        return "unknown"


def check_remote(value: str, opener=urllib.request.urlopen) -> dict:
    """Can git reach this remote, and can the public read it?"""
    remote = clean_remote(value)
    if remote is None:
        return {"reachable": False, "visibility": "unknown", "detail": "No remote to check."}

    env = {
        **os.environ,
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_SSH_COMMAND": os.environ.get("GIT_SSH_COMMAND", "ssh -o BatchMode=yes"),
        "LC_ALL": "C",
    }
    try:
        proc = subprocess.run(
            # `--` ends the options, a second guard behind clean_remote.
            ["git", "ls-remote", "--heads", "--", remote],
            env=env, capture_output=True, text=True, timeout=20,
        )
        reachable = proc.returncode == 0
        detail = "" if reachable else (proc.stderr.strip().splitlines() or ["git could not reach it"])[-1]
    except subprocess.TimeoutExpired:
        reachable, detail = False, "Timed out."
    except FileNotFoundError:
        reachable, detail = False, "git is not installed."

    visibility = github_visibility(remote, opener)
    if visibility == "private" and not reachable:
        # Invisible to the public *and* to us: more likely missing, or no access.
        visibility = "unknown"
    if visibility == "public":
        detail = "This repository is PUBLIC. Anyone can read what is pushed to it."
    return {"reachable": reachable, "visibility": visibility, "detail": detail}
