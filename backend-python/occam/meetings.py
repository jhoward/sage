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


def derive_title(text: str) -> str:
    """Guess a title from the pasted recap.

    A heuristic rather than a model call, because the note should appear the instant you
    paste. Recaps almost always lead with the meeting name; when they don't, the date is a
    fine placeholder and renaming is one command away.
    """
    for raw in text.splitlines():
        line = raw.strip().lstrip("#").strip().rstrip(":")
        if not line:
            continue
        words = [w for w in re.split(r"[\s\-–—]+", line.lower()) if w]
        if all(re.sub(r"[^\w]", "", w) in NOISE_WORDS for w in words):
            continue
        line = re.sub(r"\s+", " ", line)
        if len(line) > MAX_TITLE:
            line = line[:MAX_TITLE].rsplit(" ", 1)[0] + "…"
        return line
    return f"Meeting {date.today().isoformat()}"


def slug(title: str) -> str:
    s = re.sub(r"[^\w\s-]", "", title, flags=re.UNICODE).strip()
    s = re.sub(r"[\s_]+", "-", s).strip("-").lower()
    return s or "meeting"


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


def create(vault, text: str, when: date | None = None) -> tuple[str, str]:
    """Write a meeting note from pasted text. Returns (path, title)."""
    text = text.strip()
    if not text:
        raise ValueError("Nothing on the clipboard")

    title = derive_title(text)
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
