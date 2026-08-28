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

def test_week_id_format():
    assert todo.week_id(date(2026, 8, 27)) == "2026-W35"


def test_ensure_week_files_seeds_both(vault: Vault):
    path = todo.ensure_week_files(vault)
    assert path == todo.week_path()
    assert "## Now" in vault.read_file(path)
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


def test_quick_add_appends_to_inbox(vault: Vault):
    path = todo.append_to_inbox(vault, "Write the sync layer")
    body = vault.read_file(path)
    assert "- [ ] Write the sync layer" in body

    todo.append_to_inbox(vault, "Second task")
    lines = [l for l in vault.read_file(path).splitlines() if l.startswith("- [ ]")]
    assert lines == ["- [ ] Write the sync layer", "- [ ] Second task"]


def test_quick_add_creates_missing_heading(vault: Vault):
    vault.write_file("todo/scratch.md", "# Scratch\n")
    todo.append_to_inbox(vault, "Task", path="todo/scratch.md")
    body = vault.read_file("todo/scratch.md")
    assert "## Inbox" in body and "- [ ] Task" in body
