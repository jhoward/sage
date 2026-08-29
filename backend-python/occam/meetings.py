"""Meeting notes, and getting your commitments out of them.

The bridge from a meeting to a todo list, which is the loop this app is actually for.

Deliberately *not* an integration. Reading meeting content out of Teams or Loop means the
Graph API, an Azure AD app registration, and tenant admin consent — and a personal tool
ingesting corporate meeting transcripts is precisely the shadow-AI problem its owner would
flag at work. The clipboard is already sanctioned: pasting is a decision the user is
allowed to make, and it needs no auth at all.
"""

from __future__ import annotations

import re
import subprocess
import sys
from datetime import date
from pathlib import Path

MEETINGS_DIR = "notes/meetings"
MAX_TITLE = 60

TEMPLATE = """---
kind: meeting
date: {date}
---

# {title}

{body}
"""

# A line is boilerplate if every word in it is. Matching whole phrases was too strict:
# "AI-generated meeting notes" is three noise words and slipped through a pattern that
# expected one, so the note ended up titled after the recap header rather than the meeting.
NOISE_WORDS = {
    "ai", "generated", "aigenerated", "auto", "automatic", "meeting", "meetings",
    "note", "notes", "recap", "summary", "transcript", "minutes", "attendees",
    "attendee", "participants", "agenda", "discussion", "by", "copilot", "from",
    "date", "time", "when", "where", "location", "organizer", "organiser", "chair",
}


def read_clipboard() -> str:
    """Whatever is on the clipboard, as text."""
    if sys.platform == "darwin":
        cmd = ["pbpaste"]
    elif sys.platform.startswith("linux"):
        cmd = ["xclip", "-selection", "clipboard", "-o"]
    else:
        cmd = ["powershell", "-command", "Get-Clipboard"]

    try:
        return subprocess.run(
            cmd, capture_output=True, text=True, timeout=5, check=False
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return ""


TITLE_PROMPT = """Return this meeting's title.

If the recap contains the meeting's own name — usually a short line near the top, after any
"AI-generated notes" style header — return that name **verbatim**. That is almost always
the right answer and you should look for it first.

Only if no name is present, write one: under six words, naming the specific subject. Do not
describe the contents, and do not reach for filler like "Action Items", "Update",
"Discussion", "Framework", or "Sync" unless the meeting's own name uses it. No date — the
filename already carries one.

Return only the title, nothing else."""


def looks_like_a_name(line: str) -> bool:
    """Is this line the meeting's own name, rather than prose about it?

    Titles are short and unpunctuated; the opening sentence of a discussion is neither.
    """
    if not line or line.endswith((".", "?", "!", ":")):
        return False
    return len(line.split()) <= 8


def title_from_model(text: str, cfg=None, client=None) -> str | None:
    """Ask for a title. Returns None if there is no key or the call fails.

    Only reached when the recap does not name itself. Asked to choose between repeating a
    name that is already present and writing one, the model reliably writes one — it
    returned "AI Governance Compliance Framework Action Items" for a meeting the recap
    called "Q4 AI governance planning". It is good at the case the heuristic cannot do and
    worse at the case it can, so each handles the half it is better at.

    Cheap: a handful of output tokens at low effort.
    """
    from . import ai

    if client is None:
        key = ai.api_key(cfg)
        if not key:
            return None
        try:
            import anthropic
        except ImportError:
            return None
        ws = ai.workspace_id(cfg)
        client = anthropic.Anthropic(
            api_key=key,
            default_headers={"anthropic-workspace-id": ws} if ws else None,
        )

    try:
        response = client.messages.create(
            model="claude-opus-5",
            max_tokens=64,
            system=TITLE_PROMPT,
            output_config={"effort": "low"},
            messages=[{"role": "user", "content": text[:4000]}],
        )
    except Exception:
        return None  # a title is never worth failing the paste over

    title = "".join(b.text for b in response.content if b.type == "text").strip()
    title = title.strip('"').strip()
    if not title or len(title) > MAX_TITLE:
        return title[:MAX_TITLE] or None
    return title


def derive_title(text: str) -> str:
    """Guess a title from the pasted recap, without a model.

    The fallback: used when there is no API key, or the call fails. The app has to stay a
    good plain editor without a key, and that includes this.
    """
    for raw in text.splitlines():
        line = raw.strip().lstrip("#").strip().rstrip(":")
        if not line:
            continue
        # A label line — "Attendees: Jim, Priya" — is not a title. Checking every word
        # misses these, because the names after the colon are not boilerplate.
        label, sep, _ = line.partition(":")
        if sep and _is_all_noise(label):
            continue
        if _is_all_noise(line):
            continue
        line = re.sub(r"\s+", " ", line)
        if len(line) > MAX_TITLE:
            line = line[:MAX_TITLE].rsplit(" ", 1)[0] + "…"
        return line
    return f"Meeting {date.today().isoformat()}"


def _is_all_noise(line: str) -> bool:
    words = [w for w in re.split(r"[\s\-–—]+", line.lower()) if w]
    return bool(words) and all(re.sub(r"[^\w]", "", w) in NOISE_WORDS for w in words)


# Dropped from filenames but kept in titles: they carry no identifying weight and eat the
# word budget. Anything in a four-word slug should help you recognise the meeting.
SLUG_STOPWORDS = {
    "a", "an", "the", "and", "or", "of", "for", "on", "in", "to", "with", "about",
}
SLUG_WORDS = 4


def slug(title: str) -> str:
    """A short filename stem. The note keeps the full title; the filename stays scannable.

    Capped at a few words to match how a person names these by hand —
    `2026-08-11-ai-risk-forum.md`, not the whole sentence.
    """
    cleaned = re.sub(r"[^\w\s-]", " ", title, flags=re.UNICODE)
    words = [w for w in re.split(r"[\s_-]+", cleaned.lower()) if w]

    kept = [w for w in words if w not in SLUG_STOPWORDS] or words
    return "-".join(kept[:SLUG_WORDS]) or "meeting"


def note_path(title: str, when: date | None = None, taken: set[str] | None = None) -> str:
    """Dated path for a meeting note, suffixed if the day already has one by that name."""
    when = when or date.today()
    base = f"{MEETINGS_DIR}/{when.isoformat()}-{slug(title)}"
    taken = taken or set()

    path = f"{base}.md"
    n = 2
    while path in taken:
        path = f"{base}-{n}.md"
        n += 1
    return path


def create(
    vault, text: str, when: date | None = None, cfg=None, client=None
) -> tuple[str, str]:
    """Write a meeting note from pasted text. Returns (path, title)."""
    text = text.strip()
    if not text:
        raise ValueError("Nothing on the clipboard")

    # The recap's own name wins when it has one; the model is only asked otherwise. Most
    # recaps are named, so most pastes make no API call at all and land instantly.
    heuristic = derive_title(text)
    title = (
        heuristic
        if looks_like_a_name(heuristic)
        else (title_from_model(text, cfg, client) or heuristic)
    )
    existing = {
        p.relative_to(vault.root).as_posix()
        for p in (vault.root / MEETINGS_DIR).glob("*.md")
    } if (vault.root / MEETINGS_DIR).is_dir() else set()

    path = note_path(title, when, existing)
    vault.write_file(
        path, TEMPLATE.format(date=(when or date.today()).isoformat(), title=title, body=text)
    )
    return path, title


def follow_up_prompt(path: str, me: list[str]) -> str:
    """The question that turns a meeting note into tasks.

    Names the person explicitly: a recap lists everyone's actions, and the useful subset is
    the handful you personally owe.
    """
    who = " or ".join(f'"{n}"' for n in me) if me else "the note's author"
    return (
        f"Read {path}. Extract only the follow-ups that {who} personally committed to or "
        f"was assigned — not actions owned by anyone else, and not general discussion. "
        f"Propose each as a task for this week, phrased as a concrete next action, and "
        f"link it back to [[{Path(path).stem}]] so the reason for it stays visible. "
        f"If there are none, say so rather than inventing any."
    )
