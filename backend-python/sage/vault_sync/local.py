"""Local-only sync: doing nothing is the correct behavior.

Every method is honestly a no-op. If this class had to pretend to sync, the abstraction
would be wrong.
"""

from __future__ import annotations

from .base import SyncStatus


class LocalSync:
    backend = "local"

    def __init__(self, vault_path=None):
        self._vault_path = vault_path

    def _ok(self) -> SyncStatus:
        return SyncStatus(backend=self.backend, state="ok")

    def startup(self) -> SyncStatus:
        return self._ok()

    def tick(self) -> SyncStatus:
        return self._ok()

    def status(self) -> SyncStatus:
        return self._ok()

    def shutdown(self) -> SyncStatus:
        return self._ok()
