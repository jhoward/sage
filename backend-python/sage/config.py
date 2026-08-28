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

CONFIG_DIR = Path.home() / ".config" / "sage"
CONFIG_PATH = CONFIG_DIR / "config.toml"

DEFAULT_VAULT = Path.home() / "notes"
DEFAULT_SYNC = "local"

# Written verbatim on first run rather than serialised from a dict, because the comments
# are the point: every setting should be discoverable from the file itself, including the
# ones left empty. A TOML writer cannot emit comments, so this is a template.
TEMPLATE = """\
# Sage configuration.
#
# Machine-specific settings live here. Anything that should follow you between machines
# belongs in <vault>/.sage/ instead, so it syncs along with your notes.

# Where your notes live. Its own git repo, kept outside the app repo.
vault_path = "{vault_path}"

# Sync backend. "local" does nothing; "git" arrives in a later phase.
sync = "{sync}"

# Anthropic API key, used by skills in the command palette.
#
# Leave it empty and Sage stays a plain editor: skills still appear, and running one says
# no key is set rather than failing oddly.
#
# ANTHROPIC_API_KEY in the environment takes precedence over this value. Prefer this file
# if you launch Sage as an app, since a shell profile does not reach a GUI launch.
#
# Keep the key here rather than anywhere inside the vault — the vault becomes a git repo.
anthropic_api_key = "{anthropic_api_key}"
"""


def _escape(value: str) -> str:
    """Escape for a TOML basic string."""
    return value.replace("\\", "\\\\").replace('"', '\\"')


@dataclass
class Config:
    vault_path: Path
    sync: str = DEFAULT_SYNC
    # Optional. ANTHROPIC_API_KEY takes precedence; either way the key stays in the
    # backend and never reaches the frontend bundle.
    anthropic_api_key: str | None = None

    def render(self) -> str:
        return TEMPLATE.format(
            vault_path=_escape(str(self.vault_path)),
            sync=_escape(self.sync),
            anthropic_api_key=_escape(self.anthropic_api_key or ""),
        )

    def save(self, path: Path = CONFIG_PATH) -> None:
        """Write the documented template.

        Only called when creating the file. An existing config is never rewritten: it may
        carry the user's own comments, and clobbering those to tidy formatting would be a
        poor trade.
        """
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(self.render(), encoding="utf-8")


def load(path: Path = CONFIG_PATH) -> Config:
    """Read config, creating a documented one on first run."""
    if not path.exists():
        cfg = Config(vault_path=DEFAULT_VAULT)
        cfg.save(path)
        return cfg

    with path.open("rb") as fh:
        raw = tomllib.load(fh)

    return Config(
        vault_path=Path(raw.get("vault_path", DEFAULT_VAULT)).expanduser(),
        sync=raw.get("sync", DEFAULT_SYNC),
        anthropic_api_key=raw.get("anthropic_api_key") or None,
    )
