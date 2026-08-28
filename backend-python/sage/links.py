"""Renaming a note without breaking the links that point at it.

This is the one piece of wiki rot worth preventing early: rename `cloud-networking` and
every `[[cloud-networking]]` in the vault silently stops resolving. The links keep looking
fine — dotted rather than blue — so the damage is quiet and cumulative.

Link *parsing* lives in the frontend (see the note in vault.py about keeping the backend
dumb). This module exists because rewriting links means touching every file in the vault,
which is a file-system operation, not a rendering one.
"""

from __future__ import annotations

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


def rename(vault, old_path: str, new_path: str) -> RenameResult:
    """Move a note and repoint every link that referenced it."""
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
    vault.write_file(new_path, body)
    source.unlink()

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
