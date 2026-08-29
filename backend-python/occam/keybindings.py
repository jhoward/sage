"""Keybinding overrides, as a file in the vault.

Lives at `<vault>/.occam/keybindings.toml` rather than in ~/.config, because a binding you
have retrained your fingers on should follow you between machines the way your notes do.

The defaults are not duplicated here. They live in the frontend, which is what uses them,
and this only records the differences — so the two cannot drift. The template written on
request is generated *from* the frontend's current defaults for the same reason.

    palette = "mod+k"
    newNote = "mod+shift+n"

`mod` is ⌘ on macOS and Ctrl elsewhere. Unknown names and unparseable lines are reported
rather than applied: a typo should tell you, not silently drop a shortcut.
"""

from __future__ import annotations

import tomllib
from dataclasses import dataclass, field

PATH = ".occam/keybindings.toml"
MODIFIERS = {"mod", "shift", "alt"}

HEADER = """\
# Keybindings for Occam Notes.
#
# One line per command: `name = "mod+shift+k"`. `mod` is ⌘ on macOS and Ctrl elsewhere;
# `shift` and `alt` are the others. The key itself comes last.
#
# This file lives in the vault, so bindings follow your notes between machines. Delete a
# line to go back to its default, or delete the file to reset everything.
#
# The convention worth keeping: ⌘ alone means you do it many times a day, everything else
# takes shift. Every line below is currently set to its default.
"""


@dataclass
class Bindings:
    overrides: dict[str, dict] = field(default_factory=dict)
    problems: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"overrides": self.overrides, "problems": self.problems}


def parse_spec(value: str) -> dict | None:
    """"mod+shift+f" to {key, mod, shift, alt}. None if it cannot be read."""
    parts = [p.strip().lower() for p in str(value).split("+") if p.strip()]
    if not parts:
        return None

    key = parts[-1]
    mods = parts[:-1]
    # A modifier cannot be the key: "mod+" splits to a single part and would otherwise
    # bind the literal key "mod".
    if not key or key in MODIFIERS or any(m not in MODIFIERS for m in mods):
        return None

    return {
        "key": key,
        "mod": "mod" in mods,
        "shift": "shift" in mods,
        "alt": "alt" in mods,
    }


def load(vault, known: set[str] | None = None) -> Bindings:
    """Read overrides. A missing file is not a problem — it means the defaults."""
    result = Bindings()
    try:
        raw = tomllib.loads(vault.read_file(PATH))
    except Exception:
        return result

    seen: dict[str, str] = {}
    for name, value in raw.items():
        if known is not None and name not in known:
            result.problems.append(f"{name}: not a command")
            continue

        spec = parse_spec(value)
        if spec is None:
            result.problems.append(f"{name}: cannot read {value!r}")
            continue

        combo = "+".join(
            [m for m in ("mod", "shift", "alt") if spec[m]] + [spec["key"]]
        )
        if combo in seen:
            result.problems.append(f"{name}: same keys as {seen[combo]}")
            continue

        seen[combo] = name
        result.overrides[name] = spec

    return result


def render(defaults: dict[str, dict]) -> str:
    """A template listing every command at its current default."""
    lines = [HEADER]
    for name, spec in sorted(defaults.items()):
        combo = "+".join(
            [m for m in ("mod", "shift", "alt") if spec.get(m)] + [str(spec.get("key", ""))]
        )
        lines.append(f'{name} = "{combo}"')
    return "\n".join(lines) + "\n"


def ensure_template(vault, defaults: dict[str, dict]) -> str:
    """Write the template if it does not exist yet. Never overwrites edits."""
    if not (vault.root / PATH).exists():
        vault.write_file(PATH, render(defaults))
    return PATH
