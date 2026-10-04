"""Pinned notes: the short list at the top of the sidebar.

The pins are a file, `.occam/pins.md`, one vault path per line as a markdown list. A file
rather than a setting because it then follows the vault across machines, can be reordered
by hand in the editor, and shows up under the settings folder like every other preference.

    - todo/general.md
    - todo/occam.md
    - notes/reading.md

Any note can be pinned; there is no hierarchy up there and nothing special about todo
lists except that they are what you most often want within reach. The top of the sidebar
used to be two fixed rows, "This week" and "Backlog". Those were pins the app chose for
you, and this is the same idea with the choice handed back.
"""

from __future__ import annotations

from .vault import VaultError

PINS_PATH = ".occam/pins.md"


def read(vault) -> list[str]:
    """Pinned paths, in file order, skipping any whose note has gone."""
    try:
        body = vault.read_file(PINS_PATH)
    except VaultError:
        return []
    out: list[str] = []
    for raw in body.splitlines():
        line = raw.strip()
        if line.startswith(("- ", "* ")):
            line = line[2:].strip()
        if not line or line.startswith("#"):
            continue
        if line not in out and (vault.root / line).is_file():
            out.append(line)
    return out


def write(vault, paths: list[str]) -> None:
    body = "".join(f"- {p}\n" for p in paths)
    vault.write_file(PINS_PATH, body)


def pin(vault, path: str) -> list[str]:
    pins = read(vault)
    if path not in pins:
        pins.append(path)
        write(vault, pins)
    return pins


def unpin(vault, path: str) -> list[str]:
    pins = read(vault)
    if path in pins:
        pins.remove(path)
        write(vault, pins)
    return pins


def moved(vault, old: str, new: str) -> None:
    """A note was renamed or moved: the pin follows it. Folder renames pass a prefix."""
    pins = _raw(vault)
    if not pins:
        return
    changed = False
    for i, p in enumerate(pins):
        if p == old:
            pins[i] = new
            changed = True
        elif p.startswith(old.rstrip("/") + "/"):
            pins[i] = new.rstrip("/") + p[len(old.rstrip("/")) :]
            changed = True
    if changed:
        write(vault, pins)


def _raw(vault) -> list[str]:
    """Every pinned path as written, including ones whose file is missing right now —
    which during a rename is the file that has just moved."""
    try:
        body = vault.read_file(PINS_PATH)
    except VaultError:
        return []
    out = []
    for raw in body.splitlines():
        line = raw.strip()
        if line.startswith(("- ", "* ")):
            line = line[2:].strip()
        if line and not line.startswith("#"):
            out.append(line)
    return out
