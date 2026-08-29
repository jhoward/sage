"""Renaming a note without breaking the links that point at it.

This is the one piece of wiki rot worth preventing early: rename `cloud-networking` and
every `[[cloud-networking]]` in the vault silently stops resolving. The links keep looking
fine — dotted rather than blue — so the damage is quiet and cumulative.

Link *parsing* lives in the frontend (see the note in vault.py about keeping the backend
dumb). This module exists because rewriting links means touching every file in the vault,
which is a file-system operation, not a rendering one.
"""

from __future__ import annotations

import pathlib

import re
from dataclasses import dataclass
from pathlib import Path

LINK_RE = re.compile(r"\[\[([^\]\n|]+)(\|[^\]\n]*)?\]\]")


@dataclass
class RenameResult:
    old_path: str
    new_path: str
    updated: list[str]  # files whose links were rewritten

    def to_dict(self) -> dict:
        return {
            "oldPath": self.old_path,
            "newPath": self.new_path,
            "updated": self.updated,
        }


def stem(path: str) -> str:
    return Path(path).stem


def rewrite_links(text: str, old: str, new: str) -> tuple[str, int]:
    """Point `[[old]]` at `[[new]]`, preserving any `|alias`.

    Matches on the exact target name, case-insensitively. Deliberately not fuzzy: a rename
    should touch the links that actually pointed at this note and nothing else.
    """
    count = 0

    def replace(m: re.Match) -> str:
        nonlocal count
        target = m.group(1).strip()
        if target.removesuffix(".md").lower() != old.lower():
            return m.group(0)
        count += 1
        return f"[[{new}{m.group(2) or ''}]]"

    return LINK_RE.sub(replace, text), count


H1_RE = re.compile(r"^#\s+.*$", re.M)


def set_heading(body: str, title: str) -> str:
    """Update the note's first `# heading`, if it has one.

    Only when one exists: adding a heading to a note that deliberately has none would be
    editing content under cover of a rename.
    """
    m = H1_RE.search(body)
    if not m:
        return body
    return body[: m.start()] + f"# {title}" + body[m.end():]


def rename(vault, old_path: str, new_path: str, title: str = "") -> RenameResult:
    """Move a note and repoint every link that referenced it.

    With `title`, the note's `# heading` is set to match — so renaming states the title
    once and the filename and the heading cannot drift apart. Doing it the other way round
    — watching the heading and renaming the file to follow — would move files while you
    typed and churn links mid-keystroke.
    """
    source = vault.resolve(old_path)
    if not source.is_file():
        raise ValueError(f"not a file: {old_path}")

    if not new_path.endswith(".md"):
        new_path += ".md"
    target = vault.resolve(new_path)
    if target.exists():
        raise ValueError(f"already exists: {new_path}")

    old_stem, new_stem = stem(old_path), stem(new_path)

    # Move first: a half-done rename that moved the file but missed some links is
    # recoverable by hand, whereas rewritten links pointing at a file that never moved
    # would be actively wrong.
    body = vault.read_file(old_path)
    if title:
        body = set_heading(body, title)
    vault.write_file(new_path, body)
    source.unlink()
    vault.prune_empty_dirs(source.parent)

    updated: list[str] = []
    if old_stem != new_stem:
        for path in _markdown_files(vault):
            if path == old_path:
                continue
            try:
                text = vault.read_file(path)
            except (OSError, UnicodeDecodeError):
                continue
            rewritten, n = rewrite_links(text, old_stem, new_stem)
            if n:
                vault.write_file(path, rewritten)
                updated.append(path)

    return RenameResult(old_path, new_path, updated)


def _markdown_files(vault) -> list[str]:
    return [
        p.relative_to(vault.root).as_posix()
        for p in sorted(vault.root.rglob("*.md"))
        if not any(part.startswith(".") for part in p.parts)
    ]


ARCHIVE_DIR = "archive"


def archive(vault, path: str) -> tuple[str, dict[str, str]]:
    """Move a note into archive/, keeping which folder it came from.

    Returns the new path and a snapshot for undo: the original path with its contents, and
    the new path empty, so undoing restores the file where it was *and* removes the copy.

    Archiving is a move, not a delete — search, links and the ask panel still reach it. The
    point is only to keep the folders you look at daily worth looking at, which matters
    most for todo/, where a week file lands every week.
    """
    source = vault.resolve(path)
    if not source.is_file():
        raise ValueError(f"not a file: {path}")

    parts = path.split("/")
    if parts[0] == ARCHIVE_DIR:
        raise ValueError(f"already archived: {path}")

    # Keep the source folder inside the archive, so provenance survives and two notes with
    # the same name from different folders cannot collide.
    target = f"{ARCHIVE_DIR}/{path}"
    if (vault.root / target).exists():
        raise ValueError(f"already exists: {target}")

    body = vault.read_file(path)
    vault.write_file(target, body)
    source.unlink()
    vault.prune_empty_dirs(source.parent)

    return target, {path: body, target: ""}


def rename_folder(vault, old: str, new: str) -> tuple[list[str], dict[str, str]]:
    """Rename a folder, moving everything under it. Returns moved paths and an undo snapshot.

    Basenames do not change, so `[[vendor-risk]]` keeps resolving. Path-style links
    (`[[governance/vendor-risk]]`) would not, so those are rewritten too — the same
    reasoning as renaming a note, applied one level up.
    """
    old = old.strip("/")
    new = new.strip("/")
    if not old or not new:
        raise ValueError("a folder name is required")
    if old == new:
        return [], {}

    source = vault.resolve(old)
    if not source.is_dir():
        raise ValueError(f"not a folder: {old}")
    if (vault.root / new).exists():
        raise ValueError(f"already exists: {new}")

    files = sorted(
        p.relative_to(vault.root).as_posix() for p in source.rglob("*.md")
    )
    if not files:
        raise ValueError(f"no notes in {old}")

    snapshot: dict[str, str] = {}
    moved: list[str] = []
    # Deepest first: pruning walks *up* from a directory, so an empty nested folder left
    # behind would stop its parent being removed.
    emptied: list[pathlib.Path] = []

    for rel in files:
        target = f"{new}/{rel[len(old) + 1:]}"
        body = vault.read_file(rel)
        snapshot[rel] = body
        snapshot.setdefault(target, "")
        vault.write_file(target, body)
        original = vault.root / rel
        original.unlink()
        emptied.append(original.parent)
        moved.append(target)

    for directory in sorted(set(emptied), key=lambda d: len(d.parts), reverse=True):
        vault.prune_empty_dirs(directory)

    for rel in _markdown_files(vault):
        text = vault.read_file(rel)
        rewritten = re.sub(rf"\[\[{re.escape(old)}/", f"[[{new}/", text)
        if rewritten != text:
            snapshot.setdefault(rel, text)
            vault.write_file(rel, rewritten)

    return moved, snapshot
