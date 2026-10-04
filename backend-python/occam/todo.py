"""Todo lists.

One markdown file per list, three sections each:

    todo/general.md     ## Now · ## Backlog · ## Archive
    todo/occam.md
    todo/house.md

A list is any markdown file in todo/. The sections are headings, not a schema: capture
creates the one it targets if it is missing, and a renamed or deleted heading breaks
nothing. There is no task database and no index — the file is the only representation.

Weekly files were tried first and retired. They gave every task a date through the
filename, but the week itself turned out to be ceremony: after a few weeks the backlog had
become the real list and the week file sat unopened. What the week file did that mattered,
dating finished work, is now a `done:` stamp written when a task is checked off.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

TODO_DIR = "todo"

# Numbered items count: `1. [ ] foo` is a task in GitHub-flavoured markdown, and the editor
# makes one when ⌘⏎ is pressed inside a numbered list. Moving one re-renders it as `- [ ]`,
# so a number never travels into a list it does not belong to.
TASK_RE = re.compile(r"^(\s*(?:[-*]|\d+[.)])\s+\[)([ xX])(\]\s?)(.*)$")
LIST_RE = re.compile(r"^(\s*)(?:[-*]|\d+[.)])\s")
NUMBERED_RE = re.compile(r"^(\s*)(\d+)([.)])(\s.*)$")
HEADING_RE = re.compile(r"^#{1,6}\s")
# One trailing comment carries a task's metadata: <!-- done:2026-10-04 -->. Invisible in
# every renderer, and a single comment rather than one per key so a task with several
# never grows a tail of them.
META_RE = re.compile(r"\s*<!--\s*((?:\w+:\S+\s*)+)-->")

NOW = "## Now"
BACKLOG = "## Backlog"
ARCHIVE = "## Archive"
SECTIONS = {"now": NOW, "backlog": BACKLOG, "archive": ARCHIVE}

DEFAULT_LIST = f"{TODO_DIR}/general.md"

LIST_TEMPLATE = """# {title}

## Now

## Backlog

## Archive
"""


# ---- lists -----------------------------------------------------------


def list_paths(root: Path) -> list[str]:
    """Every list, in name order."""
    folder = root / TODO_DIR
    if not folder.is_dir():
        return []
    return [f"{TODO_DIR}/{p.name}" for p in sorted(folder.glob("*.md"))]


def ensure_lists(vault) -> list[str]:
    """The lists, creating `general` when there are none."""
    found = list_paths(vault.root)
    if found:
        return found
    vault.write_file(DEFAULT_LIST, LIST_TEMPLATE.format(title="General"))
    return [DEFAULT_LIST]


def default_list(vault) -> str:
    """Where capture goes when no list is open: the first list."""
    return ensure_lists(vault)[0]


def is_list(path: str) -> bool:
    return path.startswith(f"{TODO_DIR}/") and path.endswith(".md") and "/" not in path[len(TODO_DIR) + 1 :]


def list_title(vault, path: str) -> str:
    """A list's `# heading`, else its file name."""
    try:
        for line in vault.read_file(path).splitlines():
            if line.startswith("# "):
                return line[2:].strip()
    except Exception:
        pass
    return Path(path).stem


# ---- task lines ------------------------------------------------------


@dataclass
class Task:
    line: int  # 1-based, as the editor counts
    done: bool
    text: str  # without the checkbox or the metadata comment
    section: str
    meta: dict[str, str] = field(default_factory=dict)
    raw: str = ""
    indent: int = 0

    @property
    def done_on(self) -> date | None:
        value = self.meta.get("done")
        if not value:
            return None
        try:
            return date.fromisoformat(value)
        except ValueError:
            return None


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
        tasks.append(
            Task(
                line=n,
                done=m.group(2) != " ",
                text=META_RE.sub("", body).strip(),
                section=section,
                meta=parse_meta(body),
                raw=raw,
                indent=len(m.group(1)) - len(m.group(1).lstrip()),
            )
        )
    return tasks


def parse_meta(body: str) -> dict[str, str]:
    """Read the trailing metadata comment, if any."""
    m = META_RE.search(body)
    if not m:
        return {}
    out = {}
    for pair in m.group(1).split():
        key, _, value = pair.partition(":")
        if key and value:
            out[key] = value
    return out


def render_meta(meta: dict[str, str] | None) -> str:
    if not meta:
        return ""
    return " <!-- " + " ".join(f"{k}:{v}" for k, v in meta.items()) + " -->"


def render_task(text: str, done: bool = False, meta: dict[str, str] | None = None) -> str:
    """Render a task line, with its metadata in one trailing comment."""
    mark = "x" if done else " "
    return f"- [{mark}] {text}{render_meta(meta)}"


# ---- capture ---------------------------------------------------------


def append_task(vault, text: str, path: str | None = None, section: str = "now") -> str:
    """Quick-add. `section` is "now" (the default) or "backlog"; `path` is the list.

    Capture stays decision-free — one keystroke, one place — but the place means
    something: Now is "this is live", Backlog is "not yet".
    """
    heading = SECTIONS.get(section, NOW)
    target = path if path and is_list(path) else default_list(vault)
    if not (vault.root / target).exists():
        vault.write_file(target, LIST_TEMPLATE.format(title=Path(target).stem.title()))
    return append_to_heading(vault, text, target, heading)


def append_to_heading(vault, text: str, path: str, heading: str) -> str:
    """Append a new task at the end of a section, creating the heading if absent."""
    return append_line(vault, path, render_task(text.strip()), heading)


def append_line(vault, path: str, task: str, heading: str) -> str:
    """Append a rendered task line (or several, joined by newlines) at the end of a section."""
    lines = vault.read_file(path).splitlines()
    lines = _insert_in_section(lines, task.split("\n"), heading)
    vault.write_file(path, "\n".join(lines) + "\n")
    return path


def _insert_in_section(
    lines: list[str], block: list[str], heading: str, top: bool = False
) -> list[str]:
    """`lines` with `block` added to `heading`'s section — at its end, or with `top` at
    its start. Pure."""
    lines = list(lines)
    try:
        idx = next(i for i, line in enumerate(lines) if line.strip() == heading)
    except StopIteration:
        while lines and not lines[-1].strip():
            lines.pop()
        lines.extend(["", heading, *block])
        return lines

    if top:
        lines[idx + 1 : idx + 1] = block
        return lines

    # Insert after the last existing item in the section, so order is append.
    end = idx + 1
    while end < len(lines) and not lines[end].startswith("## "):
        end += 1
    while end > idx + 1 and not lines[end - 1].strip():
        end -= 1
    lines[end:end] = block
    return lines


def _done_key(line: str) -> str:
    """Sort key for an archive block: its done date, or '' for an undated one."""
    m = TASK_RE.match(line)
    return parse_meta(m.group(4)).get("done", "") if m else ""


def _sort_archive(lines: list[str]) -> list[str]:
    """The Archive with its newest finished work first. Pure, and stable.

    An archive is read from the top — "what did I just finish" — so the order is by
    `done:` date, latest first. Tasks finished on the same day keep their order; undated
    ones go last, in the order they were. Each task keeps its nested lines with it. Lines
    that are not tasks, and whatever precedes the first task, stay where they are.
    """
    try:
        idx = next(i for i, line in enumerate(lines) if line.strip() == ARCHIVE)
    except StopIteration:
        return lines
    end = idx + 1
    while end < len(lines) and not lines[end].startswith("## "):
        end += 1
    tail = end
    while tail > idx + 1 and not lines[tail - 1].strip():
        tail -= 1

    blocks: list[list[str]] = []
    i = idx + 1
    while i < tail:
        m = TASK_RE.match(lines[i])
        if m and not m.group(1)[0].isspace():
            j = _block_end(lines, i)
            blocks.append(lines[i:j])
            i = j
        else:
            # Not a task: stays attached to whatever came before it.
            if blocks:
                blocks[-1].append(lines[i])
            else:
                blocks.append([lines[i]])
            i += 1

    ordered = sorted(blocks, key=lambda b: _done_key(b[0]), reverse=True)
    return lines[: idx + 1] + [l for b in ordered for l in b] + lines[tail:end] + lines[end:]


# ---- moving ----------------------------------------------------------


def _block_end(lines: list[str], start: int) -> int:
    """Index just past the task at `start` and the lines nested under it.

    A task's children are the indented lines that follow it. They go where it goes: an
    archived task that left its sub-items behind would be a list of orphans.
    """
    indent = len(lines[start]) - len(lines[start].lstrip())
    end = start + 1
    while end < len(lines):
        line = lines[end]
        if not line.strip():
            break
        if len(line) - len(line.lstrip()) <= indent:
            break
        end += 1
    return end


def _remove_block(lines: list[str], start: int, end: int) -> None:
    """Delete `lines[start:end]` in place, keeping the list's starting number.

    Renumbering keeps whatever number a list starts at — a list that begins at 4 on
    purpose is not ours to correct. So when the item removed *was* the start, its number
    is handed to the next item first, or deleting item 1 would leave the list at 2.
    """
    n = NUMBERED_RE.match(lines[start])
    if n:
        indent = len(n.group(1))
        first = True
        prev = start - 1
        while prev >= 0 and lines[prev].strip():
            pm = LIST_RE.match(lines[prev])
            if not pm or len(pm.group(1)) < indent:
                break
            if len(pm.group(1)) == indent:
                first = not NUMBERED_RE.match(lines[prev])
                break
            prev -= 1
        if first:
            nxt = end
            while nxt < len(lines) and lines[nxt].strip():
                lm = LIST_RE.match(lines[nxt])
                if not lm or len(lm.group(1)) < indent:
                    break
                nm = NUMBERED_RE.match(lines[nxt])
                if nm and len(nm.group(1)) == indent:
                    lines[nxt] = f"{nm.group(1)}{n.group(2)}{nm.group(3)}{nm.group(4)}"
                    break
                nxt += 1
    del lines[start:end]


def renumber(lines: list[str]) -> list[str]:
    """Put numbered lists back in order after lines have been removed.

    Markdown renders a list in order whatever the digits say, so this is for the person
    reading the file: after an item is taken out, the numbers on screen should still
    count. A list keeps whatever number it started at, and a nested list counts on its
    own. Mirrors the editor's rule, which does the same after ⌘⇧K.
    """
    out: list[str] = []
    counters: dict[int, int] = {}
    for raw in lines:
        m = LIST_RE.match(raw)
        if not m:
            if raw.strip():
                counters.clear()  # a heading or paragraph ends every list
            out.append(raw)
            continue
        indent = len(m.group(1))
        for deeper in [k for k in counters if k > indent]:
            del counters[deeper]
        n = NUMBERED_RE.match(raw)
        if not n:
            counters.pop(indent, None)
            out.append(raw)
            continue
        if indent in counters:
            counters[indent] += 1
        else:
            counters[indent] = int(n.group(2))
        out.append(f"{n.group(1)}{counters[indent]}{n.group(3)}{n.group(4)}")
    return out


def move_task(vault, source: str, line: int, target: str, heading: str | None = None) -> Task:
    """Lift one task out of a file and append it to a section of another.

    Used by the pull picker. The task keeps its metadata, so moving a finished task does
    not lose the day it was finished. Its nested lines travel with it.
    """
    lines = vault.read_file(source).splitlines()
    if not 1 <= line <= len(lines):
        raise ValueError(f"line {line} out of range for {source}")

    task = next((t for t in parse_tasks("\n".join(lines)) if t.line == line), None)
    if task is None:
        raise ValueError(f"line {line} of {source} is not a task")

    start = line - 1
    end = _block_end(lines, start)
    block = [render_task(task.text, task.done, task.meta)]
    children = lines[start + 1 : end]
    # Children keep their relative nesting under a parent that is now a top-level bullet.
    strip = min((len(c) - len(c.lstrip()) for c in children), default=0)
    block += ["  " + c[strip:] for c in children]
    _remove_block(lines, start, end)
    lines = renumber(lines)

    if source == target:
        lines = _insert_in_section(lines, block, heading or NOW)
        vault.write_file(source, "\n".join(lines).rstrip() + "\n")
    else:
        vault.write_file(source, "\n".join(lines).rstrip() + "\n")
        append_line(vault, target, "\n".join(block), heading or NOW)
    return task


# ---- archive ---------------------------------------------------------


def archive_done(vault, path: str, before: date | None = None) -> int:
    """Move finished tasks into `## Archive`. Returns how many moved.

    With `before`, only tasks finished earlier than that day move — called with today when
    a list opens, so what you ticked off this morning is still on screen to see, and
    yesterday's is filed. Without it, everything finished moves: the palette command.

    A finished task with no date was checked somewhere other than this editor; it is
    treated as old. Only top-level tasks are considered — a finished sub-item belongs to
    its parent, whatever its state.
    """
    if not is_list(path):
        return 0
    lines = vault.read_file(path).splitlines()
    found: list[tuple[int, int, list[str]]] = []
    section = ""
    i = 0
    while i < len(lines):
        raw = lines[i]
        if HEADING_RE.match(raw):
            section = raw.strip()
            i += 1
            continue
        m = TASK_RE.match(raw)
        if section != ARCHIVE and m and m.group(2) != " " and not m.group(1)[0].isspace():
            meta = parse_meta(m.group(4))
            try:
                done_on = date.fromisoformat(meta.get("done", ""))
            except ValueError:
                done_on = None
            if before is None or done_on is None or done_on < before:
                end = _block_end(lines, i)
                text = META_RE.sub("", m.group(4)).strip()
                children = lines[i + 1 : end]
                strip = min((len(c) - len(c.lstrip()) for c in children), default=0)
                block = [render_task(text, True, meta), *("  " + c[strip:] for c in children)]
                found.append((i, end, block))
                i = end
                continue
        i += 1

    out = list(lines)
    for start, end, _block in reversed(found):
        _remove_block(out, start, end)
    if found:
        out = renumber(out)
    # Newest first: the moved blocks go on top (in file order among themselves), then the
    # archive is sorted by date, which also puts an archive written oldest-first right.
    moved = [line for _s, _e, block in found for line in block]
    if moved:
        out = _insert_in_section(out, moved, ARCHIVE, top=True)
    out = _sort_archive(out)
    if out != lines:
        vault.write_file(path, "\n".join(out).rstrip() + "\n")
    return len(found)


def recently_done(vault, days: int = 7, today: date | None = None) -> dict[str, list[Task]]:
    """Tasks finished in the last `days` days, by list — the material for a summary.

    Undated finished tasks are left out: without a day they cannot be placed in the
    window, and a summary that reached back indefinitely would not be a summary.
    """
    today = today or date.today()
    since = today - timedelta(days=days)
    out: dict[str, list[Task]] = {}
    for path in list_paths(vault.root):
        hits = [
            t
            for t in parse_tasks(vault.read_file(path))
            if t.done and t.done_on and since <= t.done_on <= today
        ]
        if hits:
            out[path] = hits
    return out


# ---- migration from weekly files -------------------------------------

WEEK_FILE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})\.md$")
FRONTMATTER_RE = re.compile(r"\A---\n.*?\n---\n", re.S)


def slug(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-") or "list"


def _split_sections(body: str) -> list[tuple[str, list[str]]]:
    """(heading, lines) pairs, with whatever precedes the first heading under ''."""
    body = FRONTMATTER_RE.sub("", body)
    sections: list[tuple[str, list[str]]] = [("", [])]
    for raw in body.splitlines():
        if raw.startswith("## "):
            sections.append((raw[3:].strip(), []))
        else:
            sections[-1][1].append(raw)
    return sections


def _sort_blocks(lines: list[str], done_on: str | None) -> tuple[list[str], list[str]]:
    """Split a section's lines into (kept, archived) blocks.

    A finished top-level task and its children are archived, stamped with `done_on` if
    one is known. Everything else — open tasks, plain items, their children — is kept in
    order. Moved tasks are re-rendered as bullets, as every move does.
    """
    kept: list[str] = []
    archived: list[str] = []
    i = 0
    while i < len(lines):
        raw = lines[i]
        m = TASK_RE.match(raw)
        if not m or m.group(1)[0].isspace():
            if raw.strip():
                kept.append(raw)
            i += 1
            continue
        end = _block_end(lines, i)
        meta = parse_meta(m.group(4))
        meta.pop("rolled", None)  # weeks are gone, so the count of them means nothing
        text = META_RE.sub("", m.group(4)).strip()
        children = lines[i + 1 : end]
        strip = min((len(c) - len(c.lstrip()) for c in children), default=0)
        children = ["  " + c[strip:] for c in children]
        if m.group(2) != " ":
            if done_on and "done" not in meta:
                meta["done"] = done_on
            archived += [render_task(text, True, meta), *children]
        else:
            kept += [render_task(text, False, meta), *children]
        i = end
    return kept, archived


def _render_list(title: str, now: list[str], backlog: list[str], archive: list[str]) -> str:
    def section(heading: str, lines: list[str]) -> str:
        return heading + ("\n" + "\n".join(lines) if lines else "") + "\n"

    return "\n".join(
        [f"# {title}\n", section(NOW, now), section(BACKLOG, backlog), section(ARCHIVE, archive)]
    )


def migrate_to_lists(vault) -> list[str]:
    """Fold the weekly files and the single backlog into lists. Runs once; then a no-op.

    Week files go into `general`: open work into Now, finished work into Archive dated
    with the Sunday that named the file. Each `## Section` of the old backlog becomes a
    list of its own, open items in Backlog and finished ones in Archive. The old files are
    removed once the new ones are written, so an interrupted run can be run again.
    """
    folder = vault.root / TODO_DIR
    if not folder.is_dir():
        return []

    weeks = sorted(p for p in folder.glob("*.md") if WEEK_FILE_RE.match(p.name))
    old_backlog = folder / "backlog.md"
    if not weeks and not old_backlog.is_file():
        return []

    # title -> (now, backlog, archive)
    lists: dict[str, tuple[list[str], list[str], list[str]]] = {}

    def bucket(title: str):
        return lists.setdefault(title, ([], [], []))

    general = bucket("General")
    for week in weeks:
        done_on = week.stem
        for _heading, lines in _split_sections(week.read_text(encoding="utf-8")):
            kept, archived = _sort_blocks(lines, done_on)
            general[0].extend(kept)
            general[2].extend(archived)

    if old_backlog.is_file():
        for heading, lines in _split_sections(old_backlog.read_text(encoding="utf-8")):
            if not heading and not any(l.strip() for l in lines):
                continue
            target = bucket(heading or "General")
            kept, archived = _sort_blocks(lines, None)
            target[1].extend(kept)
            target[2].extend(archived)

    written: list[str] = []
    for title, (now, backlog, archive) in lists.items():
        path = f"{TODO_DIR}/{slug(title)}.md"
        if (vault.root / path).exists():
            # A list by this name already exists: add to it rather than replace it.
            lines = vault.read_file(path).splitlines()
            for heading, block in ((NOW, now), (BACKLOG, backlog), (ARCHIVE, archive)):
                if block:
                    lines = _insert_in_section(lines, block, heading)
            vault.write_file(path, "\n".join(lines).rstrip() + "\n")
        else:
            vault.write_file(path, _render_list(title, now, backlog, archive))
        vault.write_file(path, "\n".join(_sort_archive(vault.read_file(path).splitlines())) + "\n")
        written.append(path)

    for week in weeks:
        week.unlink()
    if old_backlog.is_file():
        old_backlog.unlink()

    return written


ADDED_RE = re.compile(r"\s*added:\S+")


def strip_added_dates(vault) -> list[str]:
    """Remove the retired `added:` metadata. Idempotent."""
    changed = []
    for path in sorted(vault.root.rglob("*.md")):
        if any(part.startswith(".") for part in path.parts[:-1]):
            continue
        rel = path.relative_to(vault.root).as_posix()
        try:
            body = vault.read_file(rel)
        except (OSError, UnicodeDecodeError):
            continue
        if "added:" not in body:
            continue
        # Drop the key, then any comment left holding nothing.
        cleaned = ADDED_RE.sub("", body)
        cleaned = re.sub(r"\s*<!--\s*-->", "", cleaned)
        if cleaned != body:
            vault.write_file(rel, cleaned)
            changed.append(rel)
    return changed
