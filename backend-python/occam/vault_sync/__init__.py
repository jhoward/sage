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


class SyncHolder:
    """The sync backend in force, replaceable while the app runs.

    Everything that talks to sync — the routes, the ticker — holds this rather than a
    backend, so turning backup on in settings takes effect at once instead of at the next
    launch. "Restart to apply" is a poor thing to say about the setting that protects
    someone's notes: the gap between deciding and being backed up should be zero.
    """

    def __init__(self, backend: VaultSync):
        self._backend = backend
        self._swap = threading.Lock()

    @property
    def backend(self) -> str:
        return getattr(self._backend, "backend", "local")

    def replace(self, backend: VaultSync) -> None:
        """Retire the current backend and start the new one, without blocking the caller.

        Startup can involve the network, and this is called from a request handler.
        """
        with self._swap:
            old, self._backend = self._backend, backend

        def run() -> None:
            try:
                old.shutdown()  # a last commit and push under the old arrangement
            finally:
                backend.startup()

        threading.Thread(target=run, name="vault-sync-swap", daemon=True).start()

    def startup(self) -> SyncStatus:
        return self._backend.startup()

    def tick(self) -> SyncStatus:
        return self._backend.tick()

    def status(self) -> SyncStatus:
        return self._backend.status()

    def shutdown(self) -> SyncStatus:
        return self._backend.shutdown()


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


__all__ = [
    "SyncStatus", "VaultSync", "LocalSync", "GitSync", "SyncHolder", "make", "run_ticker",
]
