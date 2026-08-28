"""Weekly todo files.

The whole system is two markdown files and a naming convention:

    todo/2026-W35.md    the active week, ~20-30 items
    todo/backlog.md     persistent pool, never rolls over

The date lives in the filename, so tasks need almost no metadata: "what did I do in week
34?" is the `- [x]` lines in 2026-W34.md.

Backlog lookup resolves a glob rather than a fixed path, so moving to one backlog per
project later is `mkdir` + `mv` with no code change.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

TODO_DIR = "todo"

# Where quick-add lands. Not a schema — append_to_heading creates whatever heading it is
# given, so these can be renamed or deleted in the file without breaking anything.
#
# There is deliberately no "Inbox": an inbox earns its place only when there are several
# destinations to sort into, and there are not. It becomes meaningful once backlogs split
# per project and "unassigned" is a real state.
WEEK_CAPTURE = "## This week"
BACKLOG_CAPTURE = "## General"

WEEK_TEMPLATE = """---
week: {week}
---

## Now

## This week
"""

BACKLOG_TEMPLATE = """---
kind: backlog
---

## General
"""


def week_id(when: date | None = None) -> str:
    """ISO week identifier, e.g. 2026-W35."""
    when = when or date.today()
    iso = when.isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def week_path(when: date | None = None) -> str:
    return f"{TODO_DIR}/{week_id(when)}.md"


def backlog_paths(root: Path) -> list[str]:
    """Every backlog file, accepting either layout.

        todo/backlog.md      one file (now)
        todo/backlog/*.md    one per project (later)

    Returning a list from the start means the pull-from-backlog command never needs to
    change when the layout does.
    """
    found: list[str] = []

    single = root / TODO_DIR / "backlog.md"
    if single.is_file():
        found.append(f"{TODO_DIR}/backlog.md")

    folder = root / TODO_DIR / "backlog"
    if folder.is_dir():
        found.extend(
            f"{TODO_DIR}/backlog/{p.name}"
            for p in sorted(folder.glob("*.md"))
        )

    return found


def ensure_week_files(vault) -> str:
    """Create this week's file and a backlog if neither exists. Returns the week path."""
    path = week_path()
    target = vault.root / path
    if not target.exists():
        vault.write_file(path, WEEK_TEMPLATE.format(week=week_id()))

    if not backlog_paths(vault.root):
        vault.write_file(f"{TODO_DIR}/backlog.md", BACKLOG_TEMPLATE)

    return path


def backlog_target(vault) -> str:
    """Where a backlog capture goes: the first backlog file, created if there is none."""
    existing = backlog_paths(vault.root)
    if existing:
        return existing[0]
    path = f"{TODO_DIR}/backlog.md"
    vault.write_file(path, BACKLOG_TEMPLATE)
    return path


def append_task(vault, text: str, target: str = "week") -> str:
    """Quick-add. `target` is "week" (the default) or "backlog".

    Capture stays decision-free — always the same place — but the place now means
    something: the bottom of the week is "I'll get to it", promote it with the editor if
    it turns out to matter today.
    """
    if target == "backlog":
        return append_to_heading(vault, text, backlog_target(vault), BACKLOG_CAPTURE)
    return append_to_heading(vault, text, ensure_week_files(vault), WEEK_CAPTURE)


def append_to_heading(vault, text: str, path: str, heading: str) -> str:
    """Append a task at the end of a section, creating the heading if absent."""
    content = vault.read_file(path)
    task = f"- [ ] {text.strip()}"

    lines = content.splitlines()
    try:
        idx = next(i for i, line in enumerate(lines) if line.strip() == heading)
    except StopIteration:
        lines.extend(["", heading, task])
    else:
        # Insert after the last existing item in the section, so order is append.
        end = idx + 1
        while end < len(lines) and not lines[end].startswith("## "):
            end += 1
        while end > idx + 1 and not lines[end - 1].strip():
            end -= 1
        lines.insert(end, task)

    vault.write_file(path, "\n".join(lines) + "\n")
    return path
