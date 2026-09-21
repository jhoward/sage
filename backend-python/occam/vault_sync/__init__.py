from __future__ import annotations

import threading

from .base import SyncStatus, VaultSync
from .git import GitSync
from .local import LocalSync

_BACKENDS = {"local": LocalSync, "git": GitSync}

# How often a backend is asked to reconcile. Short, because a tick that finds nothing to
# do costs one `git status`; the backend decides for itself when a commit is due.
TICK_SECONDS = 15


def make(name: str, vault_path=None, remote: str | None = None) -> VaultSync:
    """Resolve a sync backend by name. Unknown names fall back to local."""
    if name == "git":
        return GitSync(vault_path, remote=remote)
    return _BACKENDS.get(name, LocalSync)(vault_path)


def run_ticker(sync: VaultSync, interval: float = TICK_SECONDS) -> threading.Event:
    """Call `sync.tick()` on a background thread until the returned event is set.

    The protocol has had `tick` since Phase 1 and nothing ever called it, which did not
    matter while the only backend did nothing. A daemon thread, so a tick stuck on the
    network can never keep the app from quitting.
    """
    stop = threading.Event()

    def loop() -> None:
        while not stop.wait(interval):
            try:
                sync.tick()
            except Exception:  # noqa: BLE001 — a sync bug must not take the ticker down
                pass

    threading.Thread(target=loop, name="vault-sync", daemon=True).start()
    return stop


__all__ = ["SyncStatus", "VaultSync", "LocalSync", "GitSync", "make", "run_ticker"]
