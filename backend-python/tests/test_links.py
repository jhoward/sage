"""Renaming without breaking inbound links."""

from __future__ import annotations

from pathlib import Path

import pytest

from occam import links
from occam.vault import Vault


@pytest.fixture
def vault(tmp_path: Path) -> Vault:
    v = Vault(tmp_path / "vault")
    v.ensure()
    v.write_file("notes/cloud.md", "# Cloud\n\nSee [[vpc]] and [[vpc|peering]].\n")
    v.write_file("notes/vpc.md", "# VPC\n\nBack to [[cloud]].\n")
    v.write_file("notes/other.md", "# Other\n\nMentions [[vpc-extra]] only.\n")
    return v


def test_rewrite_links_preserves_aliases():
    out, n = links.rewrite_links("[[old]] and [[old|shown]]", "old", "new")
    assert out == "[[new]] and [[new|shown]]"
    assert n == 2


def test_rewrite_links_is_exact_not_fuzzy():
    """A rename must touch the links that pointed here and nothing else."""
    out, n = links.rewrite_links("[[vpc]] [[vpc-extra]] [[my-vpc]]", "vpc", "net")
    assert out == "[[net]] [[vpc-extra]] [[my-vpc]]"
    assert n == 1


def test_rewrite_links_is_case_insensitive():
    out, n = links.rewrite_links("[[VPC]]", "vpc", "net")
    assert (out, n) == ("[[net]]", 1)


def test_rename_moves_the_file(vault: Vault):
    result = links.rename(vault, "notes/vpc.md", "notes/networking.md")

    assert result.new_path == "notes/networking.md"
    assert "# VPC" in vault.read_file("notes/networking.md")
    assert not (vault.root / "notes/vpc.md").exists()


def test_rename_updates_inbound_links(vault: Vault):
    result = links.rename(vault, "notes/vpc.md", "notes/networking.md")

    assert result.updated == ["notes/cloud.md"]
    body = vault.read_file("notes/cloud.md")
    assert "[[networking]]" in body and "[[networking|peering]]" in body
    assert "[[vpc]]" not in body


def test_rename_leaves_unrelated_links_alone(vault: Vault):
    links.rename(vault, "notes/vpc.md", "notes/networking.md")
    assert "[[vpc-extra]]" in vault.read_file("notes/other.md")


def test_rename_appends_md(vault: Vault):
    result = links.rename(vault, "notes/vpc.md", "notes/networking")
    assert result.new_path == "notes/networking.md"


def test_rename_refuses_to_overwrite(vault: Vault):
    with pytest.raises(ValueError, match="already exists"):
        links.rename(vault, "notes/vpc.md", "notes/cloud.md")


def test_rename_refuses_a_missing_file(vault: Vault):
    with pytest.raises(ValueError, match="not a file"):
        links.rename(vault, "notes/nope.md", "notes/x.md")


def test_moving_without_renaming_leaves_links_intact(vault: Vault):
    """Same basename in a new folder: links resolve by stem, so nothing needs rewriting."""
    result = links.rename(vault, "notes/vpc.md", "archive/vpc.md")
    assert result.updated == []
    assert "[[vpc]]" in vault.read_file("notes/cloud.md")


def test_list_files_can_reveal_settings(vault: Vault):
    vault.write_file(".occam/skills/cleanup.md", "prompt")
    assert all(n.name != ".occam" for n in vault.list_files())
    assert any(n.name == ".occam" for n in vault.list_files(include_hidden=True))


# ---- archiving --------------------------------------------------------

def test_archive_keeps_the_source_folder(vault: Vault):
    target, _ = links.archive(vault, "notes/vpc.md")

    assert target == "archive/notes/vpc.md"
    assert "# VPC" in vault.read_file(target)
    assert not (vault.root / "notes/vpc.md").exists()


def test_archive_snapshot_undoes_the_move(vault: Vault):
    from occam import chat

    before = vault.read_file("notes/vpc.md")
    target, snapshot = links.archive(vault, "notes/vpc.md")

    chat.undo(vault, snapshot)
    assert vault.read_file("notes/vpc.md") == before
    assert not (vault.root / target).exists()  # the archived copy goes too


def test_archive_refuses_to_archive_twice(vault: Vault):
    links.archive(vault, "notes/vpc.md")
    with pytest.raises(ValueError, match="not a file"):
        links.archive(vault, "notes/vpc.md")


def test_archive_refuses_a_note_already_in_the_archive(vault: Vault):
    links.archive(vault, "notes/vpc.md")
    with pytest.raises(ValueError, match="already archived"):
        links.archive(vault, "archive/notes/vpc.md")


def test_same_name_from_two_folders_does_not_collide(vault: Vault):
    vault.write_file("meetings/vpc.md", "# A meeting about VPCs\n")
    links.archive(vault, "notes/vpc.md")
    links.archive(vault, "meetings/vpc.md")

    assert "# VPC" in vault.read_file("archive/notes/vpc.md")
    assert "a meeting" in vault.read_file("archive/meetings/vpc.md").lower()


def test_archived_notes_are_still_searchable(vault: Vault):
    """Archiving tidies the tree; it must not hide anything from search."""
    links.archive(vault, "notes/vpc.md")
    assert any("archive/" in h.path for h in vault.search("VPC"))


# ---- renaming a folder ------------------------------------------------

def test_rename_folder_moves_everything_under_it(vault: Vault):
    vault.write_file("notes/governance/one.md", "# One\n")
    vault.write_file("notes/governance/deep/two.md", "# Two\n")

    moved, _ = links.rename_folder(vault, "notes/governance", "notes/ai-governance")

    assert moved == ["notes/ai-governance/deep/two.md", "notes/ai-governance/one.md"]
    assert "# Two" in vault.read_file("notes/ai-governance/deep/two.md")
    assert not (vault.root / "notes/governance").exists()


def test_basename_links_keep_working(vault: Vault):
    """A folder rename does not change basenames, so [[one]] still resolves."""
    vault.write_file("notes/governance/one.md", "# One\n")
    vault.write_file("notes/other.md", "See [[one]].\n")

    links.rename_folder(vault, "notes/governance", "notes/ai-governance")
    assert "[[one]]" in vault.read_file("notes/other.md")


def test_path_style_links_are_repointed(vault: Vault):
    """[[governance/one]] would break; the same reasoning as renaming a note."""
    vault.write_file("notes/governance/one.md", "# One\n")
    vault.write_file("notes/other.md", "See [[notes/governance/one]].\n")

    links.rename_folder(vault, "notes/governance", "notes/ai-governance")
    assert "[[notes/ai-governance/one]]" in vault.read_file("notes/other.md")


def test_rename_folder_is_undoable(vault: Vault):
    from occam import chat

    vault.write_file("notes/governance/one.md", "# One\n")
    vault.write_file("notes/other.md", "See [[notes/governance/one]].\n")
    _, snapshot = links.rename_folder(vault, "notes/governance", "notes/ai-governance")

    chat.undo(vault, snapshot)
    assert vault.read_file("notes/governance/one.md") == "# One\n"
    assert "[[notes/governance/one]]" in vault.read_file("notes/other.md")
    assert not (vault.root / "notes/ai-governance/one.md").exists()


def test_rename_folder_refuses_an_existing_target(vault: Vault):
    vault.write_file("notes/a/one.md", "x")
    vault.write_file("notes/b/two.md", "x")
    with pytest.raises(ValueError, match="already exists"):
        links.rename_folder(vault, "notes/a", "notes/b")


def test_rename_folder_refuses_a_file_or_a_missing_folder(vault: Vault):
    vault.write_file("notes/a/one.md", "x")
    with pytest.raises(ValueError, match="not a folder"):
        links.rename_folder(vault, "notes/a/one.md", "notes/b")
    with pytest.raises(ValueError, match="not a folder"):
        links.rename_folder(vault, "notes/nope", "notes/b")


def test_renaming_a_folder_to_itself_does_nothing(vault: Vault):
    vault.write_file("notes/a/one.md", "x")
    assert links.rename_folder(vault, "notes/a", "notes/a") == ([], {})
