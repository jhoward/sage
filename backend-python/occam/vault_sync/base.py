"""The sync contract.

Sync operates on the folder *underneath* the vault API — read_file and write_file never
know it exists. That is what keeps this seam clean: LocalSync is a genuine no-op rather
than a stub pretending to do something.

git.py is the second implementation (commit when you pause; fetch, rebase, push). A
drive.py over rclone bisync was considered and not built. Selected by the `sync` key in
~/.config/occam/config.toml.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol, runtime_checkable

# What the indicator shows, as colours:
#   green   ok        nothing is waiting: committed, and pushed if there is a remote
#   yellow  pending   edits not yet committed — it commits when you pause
#           syncing   an exchange with the remote is under way
#           offline   no network; the commits are safe here and go out by themselves
#   red     conflict  edited here and elsewhere
#           error     it will not fix itself: a rejected key, a missing repository
# Grey is the local backend, which has nothing to report. The line between yellow and red
# is "will this resolve without you". A laptop is offline a lot; red has to stay rare
# enough to mean something.
State = Literal["ok", "pending", "syncing", "conflict", "offline", "error"]


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
