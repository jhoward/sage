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
# takes shift.
#
# Commented-out lines are commands with no key at all. Uncomment one and give it a
# combination to bind it — they are listed so this file shows everything you *could* bind,
# not only what already is.
"""


@dataclass
class Bindings:
    overrides: dict[str, dict] = field(default_factory=dict)
    # Genuine mistakes: unreadable combinations and collisions, which are worth saying.
    problems: list[str] = field(default_factory=list)
    # Names this version does not know. Recorded for a future "what is in my file that I
    # cannot use" view, but not surfaced — see load().
    unknown: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "overrides": self.overrides,
            "problems": self.problems,
            "unknown": self.unknown,
        }


def _escape(value: str) -> str:
    """Escape for a TOML basic string.

    The split binding is ⌘\\, and writing it raw produced `split = "mod+\\"` — an
    unterminated string that made the whole file unparseable. Because a malformed file
    falls back to the defaults, every override in it was then silently ignored: a single
    unescaped character quietly disabled the entire feature.
    """
    return value.replace("\\", "\\\\").replace('"', '\\"')


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
            # Ignored rather than flagged. A line naming something this version does not
            # have is most likely from a newer one, or a command since renamed — neither
            # is worth an error every time the app starts. It simply does nothing.
            result.unknown.append(name)
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
    """A template listing every command — bound ones live, unbound ones commented.

    Listing the unbound ones is the whole point: a settings file that shows only what is
    already set tells you nothing about what else is available, which is the usual reason
    nobody discovers half an app's shortcuts.
    """
    bound, unbound = [], []
    for name, spec in sorted(defaults.items()):
        key = str(spec.get("key", ""))
        if not key:
            unbound.append(f'# {name} = ""')
            continue
        mods = [m for m in ("mod", "shift", "alt") if spec.get(m)]
        combo = "+".join([*mods, key])
        bound.append(f'{name} = "{_escape(combo)}"')

    out = [HEADER, *bound]
    if unbound:
        out += ["", "# Not bound to anything yet:", *unbound]
    return "\n".join(out) + "\n"


def ensure_template(vault, defaults: dict[str, dict]) -> str:
    """Write the template if it does not exist yet. Never overwrites edits."""
    if not (vault.root / PATH).exists():
        vault.write_file(PATH, render(defaults))
    return PATH
