"""Conformance suite for the vault contract.

This is the artifact that keeps a future Rust backend honest: whatever implements
VaultBackend must pass these same cases.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from occam.vault import Vault, VaultError


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
    vault.write_file(".occam/skills/cleanup.md", "prompt")
    assert all(n.name != ".occam" for n in vault.list_files())


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


def test_top_level_folders_are_ordered_by_usefulness(vault: Vault):
    """Alphabetical put archive first — the least-used folder at the top of the sidebar."""
    for folder in ["archive", "meetings", "notes", "todo", "zebra"]:
        vault.write_file(f"{folder}/a.md", "x")

    names = [n.name for n in vault.list_files() if n.isDir] if False else [
        n.name for n in vault.list_files() if n.is_dir
    ]
    assert names == ["todo", "meetings", "notes", "zebra", "archive"]


def test_deleting_the_last_note_removes_its_folder(vault: Vault):
    """Folders exist because files are in them; the last file out takes the folder."""
    vault.write_file("notes/governance/only.md", "x")
    vault.delete_file("notes/governance/only.md")

    assert not (vault.root / "notes/governance").exists()
    assert (vault.root / "notes").is_dir()  # a folder with siblings survives


def test_pruning_stops_at_a_folder_that_still_has_files(vault: Vault):
    vault.write_file("notes/governance/one.md", "x")
    vault.write_file("notes/governance/two.md", "x")
    vault.delete_file("notes/governance/one.md")

    assert (vault.root / "notes/governance").is_dir()


def test_pruning_never_removes_the_vault_root(vault: Vault):
    vault.write_file("only.md", "x")
    vault.delete_file("only.md")
    assert vault.root.is_dir()


def test_pruning_walks_up_nested_empties(vault: Vault):
    vault.write_file("notes/a/b/c/deep.md", "x")
    vault.delete_file("notes/a/b/c/deep.md")
    assert not (vault.root / "notes/a").exists()
