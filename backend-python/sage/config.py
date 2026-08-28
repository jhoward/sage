"""App configuration.

Config splits by whether a setting should follow the user across machines:

  ~/.config/sage/config.toml   vault_path, sync mode  (paths differ per machine)
  <vault>/.sage/keybindings.toml   keybindings, prefs (syncs with the vault)

Only the machine-local half lives here. Keybinding overrides are a later phase.
"""

from __future__ import annotations

import tomllib
from dataclasses import dataclass
from pathlib import Path

import tomli_w

CONFIG_DIR = Path.home() / ".config" / "sage"
CONFIG_PATH = CONFIG_DIR / "config.toml"

DEFAULT_VAULT = Path.home() / "notes"
DEFAULT_SYNC = "local"


@dataclass
class Config:
    vault_path: Path
    sync: str = DEFAULT_SYNC

    def save(self) -> None:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        payload = {"vault_path": str(self.vault_path), "sync": self.sync}
        CONFIG_PATH.write_text(tomli_w.dumps(payload), encoding="utf-8")


def load(path: Path = CONFIG_PATH) -> Config:
    """Read config, creating it with defaults on first run."""
    if not path.exists():
        cfg = Config(vault_path=DEFAULT_VAULT)
        cfg.save()
        return cfg

    with path.open("rb") as fh:
        raw = tomllib.load(fh)

    return Config(
        vault_path=Path(raw.get("vault_path", DEFAULT_VAULT)).expanduser(),
        sync=raw.get("sync", DEFAULT_SYNC),
    )
