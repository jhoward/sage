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

import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

TODO_DIR = "todo"

TASK_RE = re.compile(r"^(\s*[-*]\s+\[)([ xX])(\]\s?)(.*)$")
HEADING_RE = re.compile(r"^#{1,6}\s")
ROLLED_RE = re.compile(r"\s*<!--\s*rolled:(\d+)\s*-->")
WEEK_FILE_RE = re.compile(r"^(\d{4})-W(\d{2})\.md$")

# A task that has moved this many weeks is telling you something: do it, delegate it, or
# drop it. Surfaced by rollover rather than acted on automatically.
STALE_AFTER = 5

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


def ensure_week_files(vault, when: date | None = None) -> str:
    """Create the week's file and a backlog if neither exists. Returns the week path."""
    path = week_path(when)
    target = vault.root / path
    if not target.exists():
        vault.write_file(path, WEEK_TEMPLATE.format(week=week_id(when)))

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
    """Append a new task at the end of a section, creating the heading if absent."""
    return append_line(vault, path, f"- [ ] {text.strip()}", heading)


def append_line(vault, path: str, task: str, heading: str) -> str:
    """Append a rendered task line at the end of a section."""
    lines = vault.read_file(path).splitlines()
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


# ---- task lines ------------------------------------------------------


@dataclass
class Task:
    line: int  # 1-based, as the editor counts
    done: bool
    text: str  # without the checkbox or the rolled marker
    section: str
    rolled: int = 0
    raw: str = ""


def parse_tasks(content: str) -> list[Task]:
    """Every task line in a file, tagged with the section it sits under."""
    tasks: list[Task] = []
    section = ""

    for n, raw in enumerate(content.splitlines(), start=1):
        if HEADING_RE.match(raw):
            section = raw.strip()
            continue
        m = TASK_RE.match(raw)
        if not m:
            continue

        body = m.group(4)
        rolled_m = ROLLED_RE.search(body)
        tasks.append(
            Task(
                line=n,
                done=m.group(2) != " ",
                text=ROLLED_RE.sub("", body).strip(),
                section=section,
                rolled=int(rolled_m.group(1)) if rolled_m else 0,
                raw=raw,
            )
        )
    return tasks


def render_task(text: str, rolled: int = 0, done: bool = False) -> str:
    mark = "x" if done else " "
    suffix = f" <!-- rolled:{rolled} -->" if rolled else ""
    return f"- [{mark}] {text}{suffix}"


# ---- rollover --------------------------------------------------------


@dataclass
class RolloverResult:
    source: str | None = None
    target: str = ""
    moved: list[str] = field(default_factory=list)
    stale: list[str] = field(default_factory=list)
    skipped: int = 0  # already present in the target

    def to_dict(self) -> dict:
        return {
            "source": self.source,
            "target": self.target,
            "moved": self.moved,
            "stale": self.stale,
            "skipped": self.skipped,
        }


def week_files(root: Path) -> list[str]:
    """Every week file, oldest first."""
    folder = root / TODO_DIR
    if not folder.is_dir():
        return []
    names = sorted(p.name for p in folder.glob("*.md") if WEEK_FILE_RE.match(p.name))
    return [f"{TODO_DIR}/{n}" for n in names]


def previous_week_file(root: Path, before: str) -> str | None:
    """The most recent week file older than `before` (a week id like 2026-W35)."""
    candidates = [
        p for p in week_files(root) if Path(p).stem < before
    ]
    return candidates[-1] if candidates else None


def rollover(vault, when: date | None = None) -> RolloverResult:
    """Carry unfinished work from the previous week file into the current one.

    Deterministic on purpose — no model is involved, so it is instant and it cannot
    silently drop a task. The source file is left untouched as the week's archive; what
    got done stays recorded there for the weekly summary.

    Safe to run twice: items already present in the target are skipped rather than
    duplicated.
    """
    target = ensure_week_files(vault, when)
    result = RolloverResult(target=target)

    source = previous_week_file(vault.root, before=week_id(when))
    if not source:
        return result
    result.source = source

    unfinished = [t for t in parse_tasks(vault.read_file(source)) if not t.done]
    if not unfinished:
        return result

    existing = {t.text for t in parse_tasks(vault.read_file(target))}

    for task in unfinished:
        if task.text in existing:
            result.skipped += 1
            continue
        rolled = task.rolled + 1
        heading = task.section or WEEK_CAPTURE
        append_line(vault, target, render_task(task.text, rolled), heading)
        existing.add(task.text)
        result.moved.append(task.text)
        if rolled >= STALE_AFTER:
            result.stale.append(task.text)

    return result


# ---- moving between files --------------------------------------------


def move_task(vault, source: str, line: int, target: str, heading: str | None = None) -> Task:
    """Lift one task out of a file and append it to a section of another.

    Used for send-to-backlog and pull-from-backlog. The task keeps its rolled count, so
    parking something in the backlog does not reset the record of how long it has been
    avoided.
    """
    lines = vault.read_file(source).splitlines()
    if not 1 <= line <= len(lines):
        raise ValueError(f"line {line} out of range for {source}")

    task = next((t for t in parse_tasks("\n".join(lines)) if t.line == line), None)
    if task is None:
        raise ValueError(f"line {line} of {source} is not a task")

    if heading is None:
        heading = BACKLOG_CAPTURE if target in backlog_paths(vault.root) else WEEK_CAPTURE

    del lines[line - 1]
    vault.write_file(source, "\n".join(lines).rstrip() + "\n")
    append_line(vault, target, render_task(task.text, task.rolled, task.done), heading)
    return task
