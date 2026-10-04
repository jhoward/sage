"""Lists: archiving finished work, moving between files, and the migration from weeks.

Everything here is deterministic — no model — so it must never drop, duplicate or
reorder a task. These tests exist to keep that true.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from occam import pins, todo
from occam.vault import Vault


@pytest.fixture
def vault(tmp_path: Path) -> Vault:
    v = Vault(tmp_path / "vault")
    v.ensure()
    return v


GENERAL = """# General

## Now
- [ ] Finish the sync layer
- [x] Set up the repo <!-- done:2026-10-01 -->
- [x] Checked this morning <!-- done:2026-10-04 -->
- [x] Ticked somewhere else
- [ ] Parent task
  - [x] A finished sub-item <!-- done:2026-10-01 -->
  - [ ] An open sub-item

## Backlog
1. [ ] Draft the planning doc
2. [x] Review the PR <!-- done:2026-09-30 -->
3. [ ] Follow up on JIRA-482

## Archive
- [x] Long ago <!-- done:2026-09-01 -->
"""

TODAY = date(2026, 10, 4)


# ---- parsing ---------------------------------------------------------

def test_parse_tasks_reads_sections_and_meta():
    tasks = todo.parse_tasks(GENERAL)
    by_text = {t.text: t for t in tasks}
    assert by_text["Set up the repo"].done_on == date(2026, 10, 1)
    assert by_text["Set up the repo"].section == "## Now"
    assert by_text["Draft the planning doc"].section == "## Backlog"
    assert by_text["Ticked somewhere else"].done_on is None
    assert by_text["A finished sub-item"].indent == 2


def test_render_task_roundtrips():
    line = todo.render_task("Ship it", done=True, meta={"done": "2026-10-04"})
    assert line == "- [x] Ship it <!-- done:2026-10-04 -->"
    t = todo.parse_tasks(line)[0]
    assert (t.text, t.done, t.meta) == ("Ship it", True, {"done": "2026-10-04"})


def test_render_task_without_meta_has_no_comment():
    assert todo.render_task("Plain") == "- [ ] Plain"


# ---- lists -----------------------------------------------------------

def test_ensure_lists_seeds_general(vault: Vault):
    assert todo.ensure_lists(vault) == ["todo/general.md"]
    body = vault.read_file("todo/general.md")
    assert "## Now" in body and "## Backlog" in body and "## Archive" in body


def test_ensure_lists_leaves_existing_lists_alone(vault: Vault):
    vault.write_file("todo/house.md", "# House\n\n## Now\n")
    assert todo.ensure_lists(vault) == ["todo/house.md"]
    assert not (vault.root / "todo/general.md").exists()


def test_is_list_means_directly_in_todo():
    assert todo.is_list("todo/general.md")
    assert not todo.is_list("todo/archive/old.md")
    assert not todo.is_list("notes/todo.md")


def test_list_title_is_the_heading_else_the_name(vault: Vault):
    vault.write_file("todo/aise-class.md", "# AISE Class\n\n## Now\n")
    vault.write_file("todo/house.md", "## Now\n")
    assert todo.list_title(vault, "todo/aise-class.md") == "AISE Class"
    assert todo.list_title(vault, "todo/house.md") == "house"


# ---- capture ---------------------------------------------------------

def test_quick_add_lands_in_now_of_the_given_list(vault: Vault):
    vault.write_file("todo/house.md", "# House\n\n## Now\n\n## Backlog\n")
    path = todo.append_task(vault, "Fix the gate", "todo/house.md")
    lines = vault.read_file(path).splitlines()
    assert lines[lines.index("## Now") + 1] == "- [ ] Fix the gate"


def test_quick_add_to_backlog(vault: Vault):
    vault.write_file("todo/house.md", "# House\n\n## Now\n\n## Backlog\n- [ ] Paint\n")
    todo.append_task(vault, "Gutters", "todo/house.md", "backlog")
    lines = vault.read_file("todo/house.md").splitlines()
    assert lines[lines.index("## Backlog") + 1 :] == ["- [ ] Paint", "- [ ] Gutters"]


def test_quick_add_without_a_list_uses_the_first(vault: Vault):
    path = todo.append_task(vault, "Ship it")
    assert path == "todo/general.md"
    assert "- [ ] Ship it" in vault.read_file(path)


def test_quick_add_from_a_note_uses_the_first_list(vault: Vault):
    vault.write_file("todo/house.md", "# House\n\n## Now\n")
    path = todo.append_task(vault, "Ship it", "notes/meeting.md")
    assert path == "todo/house.md"


def test_append_creates_a_missing_heading(vault: Vault):
    """Headings are not a schema — a renamed or deleted section must not break capture."""
    vault.write_file("todo/scratch.md", "# Scratch\n")
    todo.append_to_heading(vault, "Task", "todo/scratch.md", "## Someday")
    body = vault.read_file("todo/scratch.md")
    assert "## Someday" in body and "- [ ] Task" in body


# ---- archive ---------------------------------------------------------

def test_archive_before_today_leaves_todays_work_on_screen(vault: Vault):
    vault.write_file("todo/general.md", GENERAL)
    assert todo.archive_done(vault, "todo/general.md", before=TODAY) == 3

    body = vault.read_file("todo/general.md")
    now = body[body.index("## Now") : body.index("## Backlog")]
    assert "Checked this morning" in now
    assert "Set up the repo" not in now
    assert "Ticked somewhere else" not in now  # undated counts as old
    archive = body[body.index("## Archive") :]
    # Newest first; the undated one last.
    assert archive.splitlines()[1:] == [
        "- [x] Set up the repo <!-- done:2026-10-01 -->",
        "- [x] Review the PR <!-- done:2026-09-30 -->",
        "- [x] Long ago <!-- done:2026-09-01 -->",
        "- [x] Ticked somewhere else",
    ]


def test_archive_all_takes_todays_too(vault: Vault):
    vault.write_file("todo/general.md", GENERAL)
    assert todo.archive_done(vault, "todo/general.md") == 4
    assert "Checked this morning" in vault.read_file("todo/general.md").split("## Archive")[1]


def test_archive_leaves_finished_sub_items_with_their_parent(vault: Vault):
    vault.write_file("todo/general.md", GENERAL)
    todo.archive_done(vault, "todo/general.md")
    now = vault.read_file("todo/general.md").split("## Backlog")[0]
    assert "- [ ] Parent task\n  - [x] A finished sub-item" in now


def test_archive_takes_children_along(vault: Vault):
    vault.write_file(
        "todo/general.md",
        "## Now\n- [x] Parent <!-- done:2026-10-01 -->\n  - note under it\n  - [ ] child\n- [ ] Next\n\n## Archive\n",
    )
    todo.archive_done(vault, "todo/general.md", before=TODAY)
    body = vault.read_file("todo/general.md")
    assert body == (
        "## Now\n- [ ] Next\n\n## Archive\n"
        "- [x] Parent <!-- done:2026-10-01 -->\n  - note under it\n  - [ ] child\n"
    )


def test_archive_puts_newest_on_top_and_sorts_what_was_there(vault: Vault):
    """An archive written oldest-first is put right the next time the list is swept."""
    vault.write_file(
        "todo/general.md",
        "## Now\n- [x] Today <!-- done:2026-10-04 -->\n\n## Archive\n"
        "- [x] Old <!-- done:2026-09-01 -->\n  - its note\n- [x] Undated\n- [x] Newer <!-- done:2026-09-20 -->\n",
    )
    assert todo.archive_done(vault, "todo/general.md") == 1
    assert vault.read_file("todo/general.md") == (
        "## Now\n\n## Archive\n"
        "- [x] Today <!-- done:2026-10-04 -->\n"
        "- [x] Newer <!-- done:2026-09-20 -->\n"
        "- [x] Old <!-- done:2026-09-01 -->\n  - its note\n"
        "- [x] Undated\n"
    )


def test_sweep_with_nothing_to_move_still_sorts_the_archive(vault: Vault):
    vault.write_file(
        "todo/general.md",
        "## Now\n- [ ] Open\n\n## Archive\n- [x] A <!-- done:2026-09-01 -->\n- [x] B <!-- done:2026-09-02 -->\n",
    )
    assert todo.archive_done(vault, "todo/general.md", before=TODAY) == 0
    assert vault.read_file("todo/general.md").endswith(
        "## Archive\n- [x] B <!-- done:2026-09-02 -->\n- [x] A <!-- done:2026-09-01 -->\n"
    )


def test_same_day_finishes_keep_their_order(vault: Vault):
    vault.write_file(
        "todo/general.md",
        "## Now\n- [x] First <!-- done:2026-10-01 -->\n- [x] Second <!-- done:2026-10-01 -->\n\n## Archive\n",
    )
    todo.archive_done(vault, "todo/general.md")
    assert vault.read_file("todo/general.md").endswith(
        "## Archive\n- [x] First <!-- done:2026-10-01 -->\n- [x] Second <!-- done:2026-10-01 -->\n"
    )


def test_archive_renumbers_what_is_left(vault: Vault):
    vault.write_file("todo/general.md", GENERAL)
    todo.archive_done(vault, "todo/general.md")
    body = vault.read_file("todo/general.md")
    backlog = body[body.index("## Backlog") : body.index("## Archive")].strip().splitlines()
    assert backlog[1:] == ["1. [ ] Draft the planning doc", "2. [ ] Follow up on JIRA-482"]


def test_archive_keeps_a_lists_starting_number(vault: Vault):
    vault.write_file("todo/general.md", "## Now\n1. [x] First <!-- done:2026-10-01 -->\n2. [ ] Second\n3. [ ] Third\n")
    todo.archive_done(vault, "todo/general.md")
    assert vault.read_file("todo/general.md").startswith("## Now\n1. [ ] Second\n2. [ ] Third\n")


def test_archive_creates_the_heading_when_missing(vault: Vault):
    vault.write_file("todo/general.md", "## Now\n- [x] Done <!-- done:2026-10-01 -->\n")
    todo.archive_done(vault, "todo/general.md")
    assert vault.read_file("todo/general.md") == "## Now\n\n## Archive\n- [x] Done <!-- done:2026-10-01 -->\n"


def test_archive_with_nothing_to_do_leaves_the_file_untouched(vault: Vault):
    vault.write_file("todo/general.md", "## Now\n- [ ] Open\n")
    assert todo.archive_done(vault, "todo/general.md") == 0
    assert vault.read_file("todo/general.md") == "## Now\n- [ ] Open\n"


def test_archive_only_touches_lists(vault: Vault):
    vault.write_file("notes/a.md", "- [x] Done\n")
    assert todo.archive_done(vault, "notes/a.md") == 0


def test_renumber_keeps_the_start_and_nests():
    lines = ["3. [ ] a", "7. [ ] b", "   1. x", "   5. y", "9. [ ] c", "", "## Next", "4. z", "8. w"]
    assert todo.renumber(lines) == [
        "3. [ ] a", "4. [ ] b", "   1. x", "   2. y", "5. [ ] c", "", "## Next", "4. z", "5. w",
    ]


# ---- moving between lists --------------------------------------------

def test_move_pulls_into_now_of_another_list(vault: Vault):
    vault.write_file("todo/general.md", GENERAL)
    vault.write_file("todo/house.md", "# House\n\n## Now\n- [ ] Fix the gate\n\n## Backlog\n")
    task = todo.move_task(vault, "todo/general.md", 13, "todo/house.md")
    assert task.text == "Draft the planning doc"
    house = vault.read_file("todo/house.md")
    assert "## Now\n- [ ] Fix the gate\n- [ ] Draft the planning doc\n" in house
    general = vault.read_file("todo/general.md")
    assert "Draft the planning doc" not in general
    # The list left behind still counts from 1.
    assert "1. [x] Review the PR" in general and "2. [ ] Follow up" in general


def test_move_within_a_file_changes_section(vault: Vault):
    vault.write_file("todo/general.md", GENERAL)
    todo.move_task(vault, "todo/general.md", 4, "todo/general.md", todo.BACKLOG)
    body = vault.read_file("todo/general.md")
    assert "Finish the sync layer" not in body.split("## Backlog")[0]
    assert body.split("## Backlog")[1].split("## Archive")[0].rstrip().endswith("- [ ] Finish the sync layer")


def test_move_keeps_meta_and_children(vault: Vault):
    vault.write_file("todo/general.md", GENERAL)
    vault.write_file("todo/house.md", "## Now\n")
    todo.move_task(vault, "todo/general.md", 8, "todo/house.md")
    house = vault.read_file("todo/house.md")
    assert house == (
        "## Now\n- [ ] Parent task\n  - [x] A finished sub-item <!-- done:2026-10-01 -->\n  - [ ] An open sub-item\n"
    )
    assert "sub-item" not in vault.read_file("todo/general.md")


def test_move_rejects_a_non_task_line(vault: Vault):
    vault.write_file("todo/general.md", GENERAL)
    with pytest.raises(ValueError):
        todo.move_task(vault, "todo/general.md", 1, "todo/house.md")


def test_move_rejects_an_out_of_range_line(vault: Vault):
    vault.write_file("todo/general.md", GENERAL)
    with pytest.raises(ValueError):
        todo.move_task(vault, "todo/general.md", 99, "todo/house.md")


# ---- recently done ---------------------------------------------------

def test_recently_done_spans_lists_and_respects_the_window(vault: Vault):
    """Finished sub-items count: a summary is about work done, whatever its level."""
    vault.write_file("todo/general.md", GENERAL)
    vault.write_file(
        "todo/house.md",
        "## Archive\n- [x] Gate <!-- done:2026-10-02 -->\n- [x] Old <!-- done:2026-09-01 -->\n- [x] Undated\n",
    )
    out = todo.recently_done(vault, days=7, today=TODAY)
    assert {p: [t.text for t in ts] for p, ts in out.items()} == {
        "todo/general.md": ["Set up the repo", "Checked this morning", "A finished sub-item", "Review the PR"],
        "todo/house.md": ["Gate"],
    }


# ---- pins ------------------------------------------------------------

def test_pins_are_a_file_in_order(vault: Vault):
    vault.write_file("todo/general.md", "x")
    vault.write_file("notes/reading.md", "x")
    pins.pin(vault, "notes/reading.md")
    pins.pin(vault, "todo/general.md")
    pins.pin(vault, "todo/general.md")  # twice is once
    assert pins.read(vault) == ["notes/reading.md", "todo/general.md"]
    assert vault.read_file(".occam/pins.md") == "- notes/reading.md\n- todo/general.md\n"


def test_pins_skip_notes_that_have_gone(vault: Vault):
    vault.write_file(".occam/pins.md", "- notes/gone.md\n- todo/general.md\n")
    vault.write_file("todo/general.md", "x")
    assert pins.read(vault) == ["todo/general.md"]


def test_unpin(vault: Vault):
    vault.write_file("todo/general.md", "x")
    pins.pin(vault, "todo/general.md")
    assert pins.unpin(vault, "todo/general.md") == []


def test_pins_follow_a_rename_and_a_folder_rename(vault: Vault):
    vault.write_file(".occam/pins.md", "- notes/a.md\n- projects/x/b.md\n")
    pins.moved(vault, "notes/a.md", "notes/renamed.md")
    pins.moved(vault, "projects", "work")
    assert vault.read_file(".occam/pins.md") == "- notes/renamed.md\n- work/x/b.md\n"


def test_no_pins_file_means_no_pins(vault: Vault):
    assert pins.read(vault) == []


def test_pins_can_be_reordered_through_the_api(vault: Vault):
    from fastapi.testclient import TestClient
    from occam.app import create_app
    from occam import config as config_mod

    vault.write_file("todo/a.md", "x")
    vault.write_file("todo/b.md", "x")
    vault.write_file("notes/c.md", "x")
    pins.write(vault, ["todo/a.md", "todo/b.md"])
    client = TestClient(create_app(vault, cfg=config_mod.Config(vault_path=vault.root)))

    r = client.put("/api/pins", json={"paths": ["todo/b.md", "notes/c.md", "todo/a.md", "todo/a.md"]})
    assert r.status_code == 200
    assert pins.read(vault) == ["todo/b.md", "notes/c.md", "todo/a.md"]

    r = client.put("/api/pins", json={"paths": ["todo/missing.md"]})
    assert r.status_code == 400
