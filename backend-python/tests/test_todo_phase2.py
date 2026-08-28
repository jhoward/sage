"""Rollover and cross-file moves.

Rollover is deterministic on purpose: no model, so it must never drop, duplicate, or
reorder a task. These tests exist to keep that true.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from sage import todo
from sage.vault import Vault


@pytest.fixture
def vault(tmp_path: Path) -> Vault:
    v = Vault(tmp_path / "vault")
    v.ensure()
    return v


LAST_WEEK = """---
week: 2026-W34
---

## Now
- [ ] Finish the sync layer
- [x] Set up the repo

## This week
- [ ] Draft the planning doc
- [x] Review the PR
- [ ] Follow up on JIRA-482 <!-- rolled:3 -->
"""

MONDAY_W35 = date(2026, 8, 27)  # inside ISO week 2026-W35


# ---- parsing ---------------------------------------------------------

def test_parse_tasks_tags_sections_and_rolled_counts():
    tasks = todo.parse_tasks(LAST_WEEK)
    assert [t.text for t in tasks] == [
        "Finish the sync layer",
        "Set up the repo",
        "Draft the planning doc",
        "Review the PR",
        "Follow up on JIRA-482",
    ]
    assert tasks[0].section == "## Now"
    assert tasks[2].section == "## This week"
    assert tasks[4].rolled == 3
    assert [t.done for t in tasks] == [False, True, False, True, False]


def test_render_task_roundtrips():
    line = todo.render_task("Follow up on JIRA-482", rolled=4)
    assert line == "- [ ] Follow up on JIRA-482 <!-- rolled:4 -->"
    assert todo.parse_tasks(line)[0].rolled == 4
    assert todo.parse_tasks(line)[0].text == "Follow up on JIRA-482"


# ---- rollover --------------------------------------------------------

def test_rollover_carries_only_unfinished(vault: Vault):
    vault.write_file("todo/2026-W34.md", LAST_WEEK)
    result = todo.rollover(vault, MONDAY_W35)

    assert result.source == "todo/2026-W34.md"
    assert result.target == "todo/2026-W35.md"
    assert result.moved == [
        "Finish the sync layer",
        "Draft the planning doc",
        "Follow up on JIRA-482",
    ]
    body = vault.read_file(result.target)
    assert "Set up the repo" not in body  # completed work stays behind
    assert "Review the PR" not in body


def test_rollover_preserves_sections(vault: Vault):
    vault.write_file("todo/2026-W34.md", LAST_WEEK)
    todo.rollover(vault, MONDAY_W35)

    tasks = todo.parse_tasks(vault.read_file("todo/2026-W35.md"))
    by_text = {t.text: t.section for t in tasks}
    assert by_text["Finish the sync layer"] == "## Now"
    assert by_text["Draft the planning doc"] == "## This week"


def test_rollover_increments_rolled_count(vault: Vault):
    vault.write_file("todo/2026-W34.md", LAST_WEEK)
    todo.rollover(vault, MONDAY_W35)

    tasks = {t.text: t for t in todo.parse_tasks(vault.read_file("todo/2026-W35.md"))}
    assert tasks["Follow up on JIRA-482"].rolled == 4
    assert tasks["Finish the sync layer"].rolled == 1


def test_rollover_flags_stale_items(vault: Vault):
    vault.write_file(
        "todo/2026-W34.md",
        "## This week\n- [ ] Avoided forever <!-- rolled:4 -->\n- [ ] Fresh\n",
    )
    result = todo.rollover(vault, MONDAY_W35)

    assert result.stale == ["Avoided forever"]  # hit 5, worth a decision
    assert "Fresh" in result.moved and "Fresh" not in result.stale


def test_rollover_leaves_the_archive_untouched(vault: Vault):
    vault.write_file("todo/2026-W34.md", LAST_WEEK)
    todo.rollover(vault, MONDAY_W35)
    assert vault.read_file("todo/2026-W34.md") == LAST_WEEK


def test_rollover_is_safe_to_run_twice(vault: Vault):
    vault.write_file("todo/2026-W34.md", LAST_WEEK)
    todo.rollover(vault, MONDAY_W35)
    first = vault.read_file("todo/2026-W35.md")

    again = todo.rollover(vault, MONDAY_W35)
    assert again.moved == []
    assert again.skipped == 3
    assert vault.read_file("todo/2026-W35.md") == first  # no duplicates


def test_rollover_with_no_previous_week(vault: Vault):
    result = todo.rollover(vault, MONDAY_W35)
    assert result.source is None
    assert result.moved == []


def test_rollover_picks_the_most_recent_prior_week(vault: Vault):
    vault.write_file("todo/2026-W30.md", "## This week\n- [ ] Ancient\n")
    vault.write_file("todo/2026-W34.md", "## This week\n- [ ] Recent\n")
    result = todo.rollover(vault, MONDAY_W35)

    assert result.source == "todo/2026-W34.md"
    assert result.moved == ["Recent"]


def test_rollover_merges_into_an_existing_week(vault: Vault):
    """The app seeds an empty current week on launch, so the target usually exists."""
    vault.write_file("todo/2026-W34.md", LAST_WEEK)
    todo.append_task(vault, "Added today")  # creates + populates W35
    todo.rollover(vault, MONDAY_W35)

    texts = [t.text for t in todo.parse_tasks(vault.read_file("todo/2026-W35.md"))]
    assert "Added today" in texts
    assert "Draft the planning doc" in texts


# ---- moving ----------------------------------------------------------

def test_move_task_to_backlog(vault: Vault):
    week = todo.append_task(vault, "Not happening this week")
    tasks = todo.parse_tasks(vault.read_file(week))
    line = next(t.line for t in tasks if t.text == "Not happening this week")

    todo.move_task(vault, week, line, "todo/backlog.md")

    assert "Not happening this week" not in vault.read_file(week)
    assert "Not happening this week" in vault.read_file("todo/backlog.md")


def test_move_preserves_the_rolled_count(vault: Vault):
    """Parking something in the backlog must not reset how long it has been avoided."""
    vault.write_file("todo/2026-W35.md", "## This week\n- [ ] Old one <!-- rolled:4 -->\n")
    todo.ensure_week_files(vault, MONDAY_W35)
    todo.move_task(vault, "todo/2026-W35.md", 2, "todo/backlog.md")

    moved = todo.parse_tasks(vault.read_file("todo/backlog.md"))[0]
    assert moved.rolled == 4


def test_move_pulls_from_backlog_into_the_week(vault: Vault):
    todo.ensure_week_files(vault, MONDAY_W35)
    todo.append_task(vault, "Look into caching", target="backlog")
    line = todo.parse_tasks(vault.read_file("todo/backlog.md"))[0].line

    todo.move_task(vault, "todo/backlog.md", line, "todo/2026-W35.md")

    assert "Look into caching" in vault.read_file("todo/2026-W35.md")
    assert "Look into caching" not in vault.read_file("todo/backlog.md")


def test_move_rejects_a_non_task_line(vault: Vault):
    todo.ensure_week_files(vault, MONDAY_W35)
    with pytest.raises(ValueError):
        todo.move_task(vault, "todo/2026-W35.md", 1, "todo/backlog.md")


def test_move_rejects_an_out_of_range_line(vault: Vault):
    todo.ensure_week_files(vault, MONDAY_W35)
    with pytest.raises(ValueError):
        todo.move_task(vault, "todo/2026-W35.md", 999, "todo/backlog.md")
