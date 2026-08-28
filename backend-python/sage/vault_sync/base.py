"""The sync contract.

Sync operates on the folder *underneath* the vault API — read_file and write_file never
know it exists. That is what keeps this seam clean: LocalSync is a genuine no-op rather
than a stub pretending to do something.

Later implementations: git.py (pull --rebase / commit / push), drive.py (rclone bisync).
Selected by the `sync` key in ~/.config/sage/config.toml.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol, runtime_checkable

State = Literal["ok", "syncing", "conflict", "offline", "error"]


@dataclass
class SyncStatus:
    backend: str
    state: State = "ok"
    detail: str = ""
    # Notes needing manual conflict resolution, vault-relative.
    conflicts: list[str] | None = None

    def to_dict(self) -> dict:
        return {
            "backend": self.backend,
            "state": self.state,
            "detail": self.detail,
            "conflicts": self.conflicts or [],
        }


@runtime_checkable
class VaultSync(Protocol):
    def startup(self) -> SyncStatus:
        """Called before the app opens any file."""

    def tick(self) -> SyncStatus:
        """Periodic reconcile."""

    def status(self) -> SyncStatus:
        """Current state, for the UI indicator."""

    def shutdown(self) -> SyncStatus:
        """Final sync on quit."""
