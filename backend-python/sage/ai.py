"""The Claude call.

Everything AI-shaped funnels through here so there is exactly one place where a prompt is
assembled and one place where a key is read. The key lives in the backend — read from the
environment or the local config file — and never reaches the frontend bundle.

Design notes worth keeping:
  - Streaming, always. Text lands in the editor as it arrives, and streaming also avoids
    HTTP timeouts on long generations.
  - No API key is not an error state to paper over: the app must stay a good plain editor
    without one, so this reports a clear, actionable message instead of throwing.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from dataclasses import dataclass

from . import context as context_mod
from .skills import Skill

MODEL = "claude-opus-5"
MAX_TOKENS = 16000

SYSTEM = """You are an assistant embedded in a local markdown notes app.

You are editing someone's own notes, so: match the voice already on the page, keep existing
markdown and [[wiki-links]] intact, and never invent facts to fill a gap — say plainly when
something is not in the notes.

Return only the requested text. No preamble, no commentary, no code fences around prose.
"""

MISSING_KEY = (
    "No Anthropic API key. Set ANTHROPIC_API_KEY, or add "
    "anthropic_api_key to ~/.config/sage/config.toml."
)

MISSING_WORKSPACE = (
    "This is an identity-linked API key, which also needs a workspace ID.\n\n"
    "Add anthropic_workspace_id to ~/.config/sage/config.toml (Anthropic Console -> "
    "Settings -> Workspaces, it looks like wrkspc_...), then restart Sage.\n\n"
    "A standard organisation API key does not need this."
)


class AIUnavailable(Exception):
    """Raised when a skill cannot run — no key, or the SDK is not installed."""


@dataclass
class SkillRequest:
    skill: Skill
    note_path: str | None = None
    selection: str | None = None
    instruction: str | None = None  # free text for ask-style skills


def api_key(cfg=None) -> str | None:
    """Env first, then the local config file. Never the frontend."""
    key = os.environ.get("ANTHROPIC_API_KEY")
    if key:
        return key.strip() or None
    return getattr(cfg, "anthropic_api_key", None) if cfg else None


def workspace_id(cfg=None) -> str | None:
    """Only identity-linked keys need this; a standard key ignores it."""
    ws = os.environ.get("ANTHROPIC_WORKSPACE_ID")
    if ws:
        return ws.strip() or None
    return getattr(cfg, "anthropic_workspace_id", None) if cfg else None


def build_prompt(vault, req: SkillRequest) -> str:
    """Assemble the user message: the skill's prompt, then its context."""
    strategy = context_mod.get(req.skill.context)
    blob = strategy.build(vault, req.note_path, req.selection)

    parts = [req.skill.prompt]
    if req.instruction:
        parts.append(f"# Question\n\n{req.instruction}")
    if req.selection and req.skill.context != "selection":
        # The selection is what the user pointed at; keep it distinguishable from the
        # surrounding context so the model knows which part to act on.
        parts.append(f"# Selected text\n\n{req.selection}")
    if blob:
        parts.append(blob if blob.startswith("#") else f"# Text\n\n{blob}")

    return "\n\n".join(parts)


def stream_skill(vault, req: SkillRequest, cfg=None, client=None) -> Iterator[str]:
    """Yield text chunks as they arrive.

    `client` is injectable so the whole path can be tested without a key and without
    spending anything.
    """
    if client is None:
        key = api_key(cfg)
        if not key:
            raise AIUnavailable(MISSING_KEY)
        try:
            import anthropic
        except ImportError as exc:  # pragma: no cover - dependency is declared
            raise AIUnavailable("The `anthropic` package is not installed.") from exc
        # The SDK has no workspace parameter, so it rides as a header.
        ws = workspace_id(cfg)
        client = anthropic.Anthropic(
            api_key=key,
            default_headers={"anthropic-workspace-id": ws} if ws else None,
        )

    prompt = build_prompt(vault, req)

    try:
        with client.messages.stream(
            model=req.skill.model or MODEL,
            max_tokens=MAX_TOKENS,
            system=SYSTEM,
            output_config={"effort": req.skill.effort},
            messages=[{"role": "user", "content": prompt}],
        ) as stream:
            yield from stream.text_stream
    except Exception as exc:
        # The API's own wording for this one is accurate but not actionable — it names
        # the missing header, not the setting you have to edit.
        if "anthropic-workspace-id" in str(exc):
            raise AIUnavailable(MISSING_WORKSPACE) from exc
        raise
