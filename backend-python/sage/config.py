"""App configuration.

Config splits by whether a setting should follow the user across machines:

  ~/.config/sage/config.toml   vault_path, sync mode  (paths differ per machine)
  <vault>/.sage/keybindings.toml   keybindings, prefs (syncs with the vault)

Only the machine-local half lives here. Keybinding overrides are a later phase.

The file is assembled from per-setting blocks rather than serialised from a dict, because
the comments are the point: every setting should be discoverable from the file itself,
including the ones left empty. Blocks also make the file extensible — a setting added in a
later version is appended to an existing config rather than staying invisible to everyone
who already had the file. Existing lines are never touched.
"""

from __future__ import annotations

import tomllib
from dataclasses import dataclass
from pathlib import Path

CONFIG_DIR = Path.home() / ".config" / "sage"
CONFIG_PATH = CONFIG_DIR / "config.toml"

DEFAULT_VAULT = Path.home() / "notes"
DEFAULT_SYNC = "local"

HEADER = """\
# Sage configuration.
#
# Machine-specific settings live here. Anything that should follow you between machines
# belongs in <vault>/.sage/ instead, so it syncs along with your notes.
"""

# (setting name, block). Order is the order they appear in the file.
BLOCKS: list[tuple[str, str]] = [
    (
        "vault_path",
        """
# Where your notes live. Its own git repo, kept outside the app repo.
vault_path = "{vault_path}"
""",
    ),
    (
        "sync",
        """
# Sync backend. "local" does nothing; "git" arrives in a later phase.
sync = "{sync}"
""",
    ),
    (
        "anthropic_api_key",
        """
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
""",
    ),
    (
        "anthropic_workspace_id",
        """
# Workspace ID, required only if the key above is an identity-linked key. Those keys act
# on behalf of a person rather than an organisation, so the API needs to know which
# workspace the request belongs to and returns a 400 without it.
#
# Find it in the Anthropic Console under Settings -> Workspaces; it looks like
# "wrkspc_...". Leave empty for a standard API key.
anthropic_workspace_id = "{anthropic_workspace_id}"
""",
    ),
]


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
    # Only needed for identity-linked keys; a standard key ignores it.
    anthropic_workspace_id: str | None = None

    def _values(self) -> dict[str, str]:
        return {
            "vault_path": _escape(str(self.vault_path)),
            "sync": _escape(self.sync),
            "anthropic_api_key": _escape(self.anthropic_api_key or ""),
            "anthropic_workspace_id": _escape(self.anthropic_workspace_id or ""),
        }

    def block(self, name: str) -> str:
        """One setting's comment and value, ready to append."""
        body = next(b for n, b in BLOCKS if n == name)
        return body.format(**self._values())

    def render(self) -> str:
        return HEADER + "".join(self.block(name) for name, _ in BLOCKS)

    def save(self, path: Path | None = None) -> None:
        """Write the whole documented file. Only used when creating it."""
        path = path or CONFIG_PATH
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(self.render(), encoding="utf-8")


def add_missing_settings(path: Path, cfg: Config) -> list[str]:
    """Append settings the file does not mention yet. Returns the names added.

    Purely additive: existing lines, values, and the user's own comments are untouched.
    Without this, "never rewrite an existing config" would mean a setting introduced later
    stays invisible to everyone who already had the file — exactly the discoverability
    problem the documented template was meant to solve.
    """
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return []

    present = {
        line.split("=", 1)[0].strip()
        for line in text.splitlines()
        if "=" in line and not line.lstrip().startswith("#")
    }

    missing = [name for name, _ in BLOCKS if name not in present]
    if not missing:
        return []

    addition = "".join(cfg.block(name) for name in missing)
    path.write_text(text.rstrip("\n") + "\n" + addition, encoding="utf-8")
    return missing


def load(path: Path | None = None) -> Config:
    """Read config, creating a documented one on first run.

    The path is resolved at call time rather than bound as a default, so tests can point
    CONFIG_PATH somewhere harmless instead of reading the developer's real key.
    """
    path = path or CONFIG_PATH
    if not path.exists():
        cfg = Config(vault_path=DEFAULT_VAULT)
        cfg.save(path)
        return cfg

    with path.open("rb") as fh:
        raw = tomllib.load(fh)

    cfg = Config(
        vault_path=Path(raw.get("vault_path", DEFAULT_VAULT)).expanduser(),
        sync=raw.get("sync", DEFAULT_SYNC),
        anthropic_api_key=raw.get("anthropic_api_key") or None,
        anthropic_workspace_id=raw.get("anthropic_workspace_id") or None,
    )
    add_missing_settings(path, cfg)
    return cfg
