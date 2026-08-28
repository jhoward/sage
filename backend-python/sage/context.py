"""Context strategies for AI features.

Every AI feature reduces to one question: what went in the context window? Naming that
explicitly — rather than building context strings inline at each call site — is what lets
the retrieval approach change without touching anything else.

Phase 1 ships the protocol and the simplest implementation. Phase 3 adds NoteWithLinks
and TitleListing (send every note title, let the model pick which to read — see the plan
for why this defers embeddings indefinitely).
"""

from __future__ import annotations

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

    name = "current-note"

    def build(self, vault, note_path: str | None, selection: str | None) -> str:
        if not note_path:
            return selection or ""
        return vault.read_file(note_path)
