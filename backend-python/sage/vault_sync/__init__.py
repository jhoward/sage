from .base import SyncStatus, VaultSync
from .local import LocalSync

_BACKENDS = {"local": LocalSync}


def make(name: str, vault_path=None) -> VaultSync:
    """Resolve a sync backend by name. Unknown names fall back to local."""
    return _BACKENDS.get(name, LocalSync)(vault_path)


__all__ = ["SyncStatus", "VaultSync", "LocalSync", "make"]
