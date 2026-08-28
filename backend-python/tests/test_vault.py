"""Conformance suite for the vault contract.

This is the artifact that keeps a future Rust backend honest: whatever implements
VaultBackend must pass these same cases.
"""

from __future__ import annotations

import shutil
from datetime import date
from pathlib import Path

import pytest

from sage import todo
from sage.vault import Vault, VaultError


@pytest.fixture
def vault(tmp_path: Path) -> Vault:
    v = Vault(tmp_path / "vault")
    v.ensure()
    v.write_file("notes/alpha.md", "# Alpha\n\nSomething about VPC peering.\n")
    v.write_file("notes/beta.md", "# Beta\n\nUnrelated content.\n")
    v.write_file("notes/deep/gamma.md", "# Gamma\n")
    return v


# ---- read / write ----------------------------------------------------

def test_read_roundtrip(vault: Vault):
    vault.write_file("notes/x.md", "hello")
    assert vault.read_file("notes/x.md") == "hello"


def test_write_creates_parent_dirs(vault: Vault):
    vault.write_file("a/b/c.md", "nested")
    assert vault.read_file("a/b/c.md") == "nested"


def test_write_is_atomic(vault: Vault):
    """No temp files survive a successful write."""
    vault.write_file("notes/alpha.md", "replaced")
    leftovers = list((vault.root / "notes").glob(".*.tmp"))
    assert leftovers == []
    assert vault.read_file("notes/alpha.md") == "replaced"


def test_failed_write_leaves_no_temp_file(vault: Vault, monkeypatch):
    """A crash mid-write must not leave debris or a truncated note."""
    import os

    def boom(*_args, **_kwargs):
        raise OSError("disk full")

    monkeypatch.setattr(os, "replace", boom)
    with pytest.raises(OSError):
        vault.write_file("notes/alpha.md", "partial")

    assert list((vault.root / "notes").glob(".*.tmp")) == []
    assert "VPC peering" in vault.read_file("notes/alpha.md")


def test_read_missing_file(vault: Vault):
    with pytest.raises(VaultError):
        vault.read_file("notes/nope.md")


# ---- path safety -----------------------------------------------------

@pytest.mark.parametrize(
    "bad",
    ["../escape.md", "notes/../../escape.md", "/etc/passwd", "", "."],
)
def test_traversal_is_refused(vault: Vault, bad: str):
    with pytest.raises(VaultError):
        vault.resolve(bad)


def test_symlink_out_of_vault_is_refused(vault: Vault, tmp_path: Path):
    outside = tmp_path / "outside.md"
    outside.write_text("secret")
    (vault.root / "notes" / "link.md").symlink_to(outside)

    with pytest.raises(VaultError):
        vault.read_file("notes/link.md")


# ---- listing ---------------------------------------------------------

def test_list_files_is_recursive_and_sorted(vault: Vault):
    tree = vault.list_files()
    names = [n.name for n in tree]
    # directories before files, each alphabetical
    assert names.index("notes") < len(names)

    notes = next(n for n in tree if n.name == "notes")
    child_names = [c.name for c in notes.children]
    assert child_names == ["deep", "alpha.md", "beta.md"]


def test_list_files_skips_dotfiles(vault: Vault):
    vault.write_file(".sage/skills/cleanup.md", "prompt")
    assert all(n.name != ".sage" for n in vault.list_files())


# ---- search ----------------------------------------------------------

def test_search_finds_content(vault: Vault):
    hits = vault.search("VPC peering")
    assert len(hits) == 1
    assert hits[0].path == "notes/alpha.md"
    assert hits[0].line == 3


def test_search_is_case_insensitive(vault: Vault):
    assert vault.search("vpc PEERING")


def test_search_empty_query(vault: Vault):
    assert vault.search("   ") == []


@pytest.mark.skipif(shutil.which("rg") is None, reason="ripgrep not installed")
def test_search_backends_agree(vault: Vault):
    """The ripgrep and pure-Python paths must return the same thing."""
    rg = vault._search_ripgrep("VPC")
    py = vault._search_python("VPC")
    assert [(h.path, h.line) for h in rg] == [(h.path, h.line) for h in py]


# ---- todo ------------------------------------------------------------

def test_week_id_is_the_sunday_that_starts_the_week():
    assert todo.week_id(date(2026, 8, 27)) == "2026-08-23"


def test_ensure_week_files_seeds_both(vault: Vault):
    path = todo.ensure_week_files(vault)
    body = vault.read_file(path)
    assert path == todo.week_path()
    assert "## Now" in body and "## This week" in body
    assert "## Inbox" not in body
    assert todo.backlog_paths(vault.root) == ["todo/backlog.md"]


def test_ensure_week_files_is_idempotent(vault: Vault):
    path = todo.ensure_week_files(vault)
    vault.write_file(path, "edited by hand")
    todo.ensure_week_files(vault)
    assert vault.read_file(path) == "edited by hand"


def test_backlog_lookup_accepts_folder_layout(vault: Vault):
    """Moving to per-project backlogs must need no code change."""
    (vault.root / "todo" / "backlog.md").unlink(missing_ok=True)
    vault.write_file("todo/backlog/general.md", "# General\n")
    vault.write_file("todo/backlog/sage.md", "# Sage\n")

    assert todo.backlog_paths(vault.root) == [
        "todo/backlog/general.md",
        "todo/backlog/sage.md",
    ]


def test_quick_add_appends_in_order(vault: Vault):
    path = todo.append_task(vault, "Write the sync layer")
    assert "- [ ] Write the sync layer" in vault.read_file(path)

    todo.append_task(vault, "Second task")
    lines = [l for l in vault.read_file(path).splitlines() if l.startswith("- [ ]")]
    assert lines == ["- [ ] Write the sync layer", "- [ ] Second task"]


def test_quick_add_lands_under_this_week(vault: Vault):
    """Capture goes to the bottom of the week, not a separate inbox."""
    path = todo.append_task(vault, "Draft the doc")
    lines = vault.read_file(path).splitlines()

    assert "## Inbox" not in lines
    heading = lines.index(todo.WEEK_CAPTURE)
    assert lines[heading + 1] == "- [ ] Draft the doc"
    # "## Now" stays empty — capture never jumps the commitment line.
    now = lines.index("## Now")
    assert not lines[now + 1].startswith("- [ ]")


def test_backlog_capture_lands_under_general(vault: Vault):
    todo.ensure_week_files(vault)
    path = todo.append_task(vault, "Look into caching", target="backlog")
    lines = vault.read_file(path).splitlines()

    assert "## Inbox" not in lines
    heading = lines.index(todo.BACKLOG_CAPTURE)
    assert lines[heading + 1] == "- [ ] Look into caching"


def test_append_creates_missing_heading(vault: Vault):
    """Headings are not a schema — a renamed or deleted section must not break capture."""
    vault.write_file("todo/scratch.md", "# Scratch\n")
    todo.append_to_heading(vault, "Task", "todo/scratch.md", "## Someday")
    body = vault.read_file("todo/scratch.md")
    assert "## Someday" in body and "- [ ] Task" in body


def test_append_task_targets_backlog(vault: Vault):
    todo.ensure_week_files(vault)
    path = todo.append_task(vault, "Look into caching", target="backlog")

    assert path == "todo/backlog.md"
    assert "- [ ] Look into caching" in vault.read_file(path)
    # The week file is untouched.
    assert "Look into caching" not in vault.read_file(todo.week_path())


def test_append_task_defaults_to_week(vault: Vault):
    path = todo.append_task(vault, "Ship it")
    assert path == todo.week_path()
    assert "- [ ] Ship it" in vault.read_file(path)


def test_backlog_target_prefers_existing_project_file(vault: Vault):
    (vault.root / "todo" / "backlog.md").unlink(missing_ok=True)
    vault.write_file("todo/backlog/general.md", "## Inbox\n")
    assert todo.backlog_target(vault) == "todo/backlog/general.md"


def test_delete_file(vault: Vault):
    vault.delete_file("notes/alpha.md")
    assert not (vault.root / "notes/alpha.md").exists()
    with pytest.raises(VaultError):
        vault.read_file("notes/alpha.md")


def test_delete_missing_file(vault: Vault):
    with pytest.raises(VaultError):
        vault.delete_file("notes/nope.md")


def test_delete_refuses_to_escape_the_vault(vault: Vault, tmp_path: Path):
    outside = tmp_path / "outside.md"
    outside.write_text("keep me")
    with pytest.raises(VaultError):
        vault.delete_file("../outside.md")
    assert outside.exists()


def test_delete_refuses_a_directory(vault: Vault):
    with pytest.raises(VaultError):
        vault.delete_file("notes")
    assert (vault.root / "notes").is_dir()
