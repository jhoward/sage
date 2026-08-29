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
