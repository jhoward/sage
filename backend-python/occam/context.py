"""Context strategies for AI features.

Every AI feature reduces to one question: what went in the context window? Naming that
explicitly — rather than building context strings inline at each call site — is what lets
the retrieval approach change without touching anything else.

Phase 1 ships the protocol and the simplest implementation. Phase 3 adds NoteWithLinks
and TitleListing (send every note title, let the model pick which to read — see the plan
for why this defers embeddings indefinitely).
"""

from __future__ import annotations

import re
from typing import Protocol, runtime_checkable


@runtime_checkable
class ContextStrategy(Protocol):
    name: str

    def build(self, vault, note_path: str | None, selection: str | None) -> str:
        """Assemble the context blob for a skill invocation."""


class SelectionOnly:
    """Just the highlighted text. Unambiguous, cheap, and enough for cleanup/tighten."""

    name = "selection"

    def build(self, vault, note_path: str | None, selection: str | None) -> str:
        return selection or ""


class CurrentNote:
    """The whole note. Notes run ~2 pages, so this fits comfortably in context."""

    name = "note"

    def build(self, vault, note_path: str | None, selection: str | None) -> str:
        if not note_path:
            return selection or ""
        return f"# Note: {note_path}\n\n{vault.read_file(note_path)}"


class NoteAndLinks:
    """The note plus every note it links to, in full.

    No chunking and no embeddings: notes run ~2 pages, so a note and its links is
    10-20k tokens and fits with room to spare. Whole notes also beat retrieved fragments,
    which arrive stripped of the context that made them meaningful.
    """

    name = "note-and-links"
    MAX_LINKED = 10

    def build(self, vault, note_path: str | None, selection: str | None) -> str:
        if not note_path:
            return selection or ""

        body = vault.read_file(note_path)
        parts = [f"# Note: {note_path}\n\n{body}"]

        seen = {note_path}
        for target in _link_targets(body):
            if len(seen) > self.MAX_LINKED:
                break
            resolved = _resolve(vault, target)
            if not resolved or resolved in seen:
                continue
            seen.add(resolved)
            try:
                parts.append(f"# Linked note: {resolved}\n\n{vault.read_file(resolved)}")
            except Exception:
                continue

        return "\n\n---\n\n".join(parts)


class WeekDone:
    """Just the completed tasks from a week file — the raw material for a summary.

    Sending only `- [x]` lines keeps the summary grounded in what was actually finished,
    rather than letting unfinished intentions drift into a report of the week.
    """

    name = "week-done"

    def build(self, vault, note_path: str | None, selection: str | None) -> str:
        if not note_path:
            return ""
        done = [
            line.strip()
            for line in vault.read_file(note_path).splitlines()
            if _DONE_RE.match(line)
        ]
        if not done:
            return ""
        return f"# Completed in {note_path}\n\n" + "\n".join(done)


_LINK_RE = re.compile(r"\[\[([^\]\n|]+)(?:\|[^\]\n]*)?\]\]")
_DONE_RE = re.compile(r"^\s*[-*]\s+\[[xX]\]\s")


def _link_targets(text: str) -> list[str]:
    seen: list[str] = []
    for m in _LINK_RE.finditer(text):
        t = m.group(1).strip()
        if t and t not in seen:
            seen.append(t)
    return seen


def _resolve(vault, target: str) -> str | None:
    """Mirror the frontend's resolution: full path, then unique basename."""
    needle = target.removesuffix(".md").lower()
    candidates = [
        p.relative_to(vault.root).as_posix()
        for p in vault.root.rglob("*.md")
        if not any(part.startswith(".") for part in p.parts)
    ]

    for path in candidates:
        if path.lower() == f"{needle}.md":
            return path

    by_stem = [p for p in candidates if p.rsplit("/", 1)[-1][:-3].lower() == needle]
    # An ambiguous name resolves to nothing rather than guessing between two notes.
    return by_stem[0] if len(by_stem) == 1 else None


STRATEGIES = {
    s.name: s
    for s in (SelectionOnly(), CurrentNote(), NoteAndLinks(), WeekDone())
}


def get(name: str):
    """Look up a strategy, falling back to selection-only."""
    return STRATEGIES.get(name, STRATEGIES["selection"])
