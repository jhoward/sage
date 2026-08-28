"""Ask the vault.

The feature that justifies this app existing rather than using a chat window: the model
can see your notes. A question like "what have I said about override rates?" spans several
notes written weeks apart, and no general chat can answer it.

Two kinds of tool, treated very differently:

  **Reads** are executed. The model searches and opens notes as it needs them, so
  retrieval is agentic rather than a fixed strategy guessing what will be relevant.

  **Writes are never executed here.** They are collected as *proposals* and returned for
  review. Nothing in this module touches a file — see `apply_proposals`, which is a
  separate, deliberate step the user triggers.

That split is the whole safety model. It is not enforced by discipline but by structure:
the write tools have no implementation to call.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from . import ai, todo
from .vault import Vault, VaultError

MODEL = "claude-opus-5"
MAX_TOKENS = 16000
MAX_TURNS = 8  # generous for read-then-answer; a guard against a runaway loop
SEARCH_LIMIT = 30

SYSTEM = """You are answering questions about someone's personal notes vault.

Ground every answer in what the notes actually say. Read the notes you need before
answering — do not answer from general knowledge and do not guess at what a note contains.
When the notes are silent or contradict each other, say so plainly; that is a useful
answer. When you do draw on outside knowledge, mark it as such.

Cite the notes you used by their path, so the reader can check you.

You may propose changes to the vault when the user has asked for something to be recorded,
added, or updated. Do not propose changes to a question that was only a question.

One exception: if answering produced a genuine synthesis — something true across several
notes that no single note says, or a question these notes now settle — you may propose
capturing it as a new note, and say in one line why it is worth keeping. Be sparing. A
restatement of one note is not a synthesis, and a vault full of notes nobody asked for is
worse than a vault missing one.

Prefer adding to a note over rewriting it: replacing text destroys what was there, and this
vault has no version history yet.

Be direct and brief. No preamble."""

READ_TOOLS = [
    {
        "name": "search_notes",
        "description": (
            "Full-text search across the vault. Returns matching lines with their note "
            "path and line number. Use this to find which notes are relevant before "
            "reading them."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Literal text to search for."}
            },
            "required": ["query"],
        },
    },
    {
        "name": "read_note",
        "description": "Read a note in full, by its vault-relative path.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "e.g. notes/human-oversight.md"}
            },
            "required": ["path"],
        },
    },
]

WRITE_TOOLS = [
    {
        "name": "add_task",
        "description": (
            "Propose adding a task. Use target 'week' for this week's list or 'backlog' "
            "for the backlog."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "text": {"type": "string"},
                "target": {"type": "string", "enum": ["week", "backlog"]},
                "why": {"type": "string", "description": "One line: why this task."},
            },
            "required": ["text", "target"],
        },
    },
    {
        "name": "append_to_note",
        "description": (
            "Propose appending text to the end of a note, or under a heading if given. "
            "Additive and easily undone — prefer this over replace_in_note."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "text": {"type": "string"},
                "heading": {
                    "type": "string",
                    "description": "Optional '## Heading' to append under.",
                },
                "why": {"type": "string"},
            },
            "required": ["path", "text"],
        },
    },
    {
        "name": "create_note",
        "description": (
            "Propose a new note. Use this when the answer is a synthesis that does not "
            "exist in any single note and is worth keeping — connecting several notes, "
            "resolving a question, or recording a decision. The body MUST link back to "
            "the notes it draws on with [[wiki-links]], so the note joins the graph "
            "rather than sitting apart from it. Do not create a note that merely restates "
            "one existing note."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "e.g. notes/override-threshold.md",
                },
                "title": {"type": "string"},
                "body": {
                    "type": "string",
                    "description": "Markdown, including [[links]] to the source notes.",
                },
                "why": {"type": "string"},
            },
            "required": ["path", "title", "body"],
        },
    },
    {
        "name": "replace_in_note",
        "description": (
            "Propose replacing an exact span of text in a note. Destructive: the original "
            "is lost. Only use when the user explicitly asked for something to be "
            "corrected or rewritten. `old` must match the file exactly."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "old": {"type": "string"},
                "new": {"type": "string"},
                "why": {"type": "string"},
            },
            "required": ["path", "old", "new"],
        },
    },
]

# Additive proposals can be undone by deleting what was added; a replacement destroys the
# original. The UI leans on this to decide what to expand by default.
DESTRUCTIVE = {"replace_in_note"}


@dataclass
class Proposal:
    tool: str
    args: dict[str, Any]

    @property
    def destructive(self) -> bool:
        return self.tool in DESTRUCTIVE

    def to_dict(self) -> dict:
        return {"tool": self.tool, "args": self.args, "destructive": self.destructive}


@dataclass
class Answer:
    text: str = ""
    proposals: list[Proposal] = field(default_factory=list)
    read: list[str] = field(default_factory=list)  # notes opened, for citation UI

    def to_dict(self) -> dict:
        return {
            "text": self.text,
            "proposals": [p.to_dict() for p in self.proposals],
            "read": self.read,
        }


def note_index(vault: Vault) -> str:
    """Every note path, for the system prompt.

    At vault scale this is a few thousand tokens — cheaper and more reliable than making
    the model guess paths, and it means a single search often is not needed at all.
    """
    paths = [
        p.relative_to(vault.root).as_posix()
        for p in sorted(vault.root.rglob("*.md"))
        if not any(part.startswith(".") for part in p.parts)
    ]
    return "\n".join(paths)


def _run_read_tool(vault: Vault, name: str, args: dict) -> str:
    if name == "search_notes":
        hits = vault.search(args.get("query", ""))[:SEARCH_LIMIT]
        if not hits:
            return "No matches."
        return "\n".join(f"{h.path}:{h.line}: {h.text}" for h in hits)

    if name == "read_note":
        try:
            return vault.read_file(args["path"])
        except (VaultError, KeyError) as exc:
            return f"Could not read: {exc}"

    return f"Unknown tool {name}"


def ask(
    vault: Vault,
    messages: list[dict],
    cfg=None,
    client=None,
    allow_writes: bool = True,
) -> Answer:
    """Run the question to completion, executing reads and collecting writes.

    `messages` is the conversation so far, so follow-ups keep their context.
    """
    if client is None:
        key = ai.api_key(cfg)
        if not key:
            raise ai.AIUnavailable(ai.MISSING_KEY)
        import anthropic

        ws = ai.workspace_id(cfg)
        client = anthropic.Anthropic(
            api_key=key,
            default_headers={"anthropic-workspace-id": ws} if ws else None,
        )

    tools = READ_TOOLS + (WRITE_TOOLS if allow_writes else [])
    system = f"{SYSTEM}\n\n# Notes in this vault\n\n{note_index(vault)}"
    history = list(messages)
    answer = Answer()

    for _ in range(MAX_TURNS):
        response = client.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=system,
            tools=tools,
            output_config={"effort": "high"},
            messages=history,
        )

        text = "".join(b.text for b in response.content if b.type == "text")
        if text:
            answer.text = text

        calls = [b for b in response.content if b.type == "tool_use"]
        if not calls:
            break

        # Writes are collected, never run. Reads are executed and fed back so the model
        # can keep looking until it has enough to answer.
        results = []
        for call in calls:
            if call.name in {t["name"] for t in WRITE_TOOLS}:
                answer.proposals.append(Proposal(call.name, dict(call.input)))
                results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": call.id,
                        "content": "Proposed. Awaiting the user's review.",
                    }
                )
                continue

            if call.name == "read_note" and call.input.get("path"):
                answer.read.append(call.input["path"])
            results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": call.id,
                    "content": _run_read_tool(vault, call.name, dict(call.input)),
                }
            )

        history.append({"role": "assistant", "content": response.content})
        history.append({"role": "user", "content": results})

    answer.read = list(dict.fromkeys(answer.read))
    return answer


# ---- applying ---------------------------------------------------------


def apply_proposals(vault: Vault, proposals: list[dict]) -> tuple[list[str], dict[str, str]]:
    """Apply accepted proposals. Returns the changes made and a snapshot for undo.

    The snapshot holds each touched file's contents *before* the change, which is what
    makes "undo last AI change" possible without tracking ranges inside the files — the
    mistake that retired the provenance markers.
    """
    changed: list[str] = []
    snapshot: dict[str, str] = {}

    def remember(path: str) -> None:
        if path in snapshot:
            return
        try:
            snapshot[path] = vault.read_file(path)
        except VaultError:
            snapshot[path] = ""  # file did not exist; undo means deleting it

    for raw in proposals:
        tool, args = raw.get("tool"), raw.get("args", {})

        if tool == "add_task":
            target = args.get("target", "backlog")
            # Snapshot *before* anything can create the file. ensure_week_files() and
            # backlog_target() both write when the file is missing, so computing the path
            # through them first would capture a freshly-created template as the "before"
            # state — and undo would then restore an empty file instead of removing it.
            path = (
                todo.week_path()
                if target == "week"
                else f"{todo.TODO_DIR}/backlog.md"
            )
            existing = todo.backlog_paths(vault.root)
            if target == "backlog" and existing:
                path = existing[0]
            remember(path)
            todo.append_task(vault, args["text"], target)
            changed.append(f"{path}: + {args['text']}")

        elif tool == "append_to_note":
            path = args["path"]
            remember(path)
            heading = args.get("heading")
            if heading:
                todo.append_line(vault, path, args["text"], heading)
            else:
                body = vault.read_file(path).rstrip("\n")
                vault.write_file(path, f"{body}\n\n{args['text'].strip()}\n")
            changed.append(f"{path}: appended")

        elif tool == "create_note":
            path = args["path"]
            if not path.endswith(".md"):
                path += ".md"
            if (vault.root / path).exists():
                raise ValueError(f"{path}: already exists")
            remember(path)
            body = args["body"].strip()
            title = args.get("title", "").strip()
            # Lead with a heading unless the body already opens with one.
            if title and not body.startswith("#"):
                body = f"# {title}\n\n{body}"
            vault.write_file(path, body + "\n")
            changed.append(f"{path}: created")

        elif tool == "replace_in_note":
            path = args["path"]
            remember(path)
            body = vault.read_file(path)
            if args["old"] not in body:
                raise ValueError(f"{path}: the text to replace was not found")
            vault.write_file(path, body.replace(args["old"], args["new"], 1))
            changed.append(f"{path}: replaced")

        else:
            raise ValueError(f"unknown proposal {tool!r}")

    return changed, snapshot


def undo(vault: Vault, snapshot: dict[str, str]) -> list[str]:
    """Restore files to their pre-change contents."""
    restored = []
    for path, body in snapshot.items():
        if body == "":
            target = vault.resolve(path)
            if target.exists():
                target.unlink()
        else:
            vault.write_file(path, body)
        restored.append(path)
    return restored
