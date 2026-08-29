"""Keybinding overrides.

The defaults live in the frontend, which is what uses them; this only records differences,
so the two cannot drift.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from occam import keybindings as keys
from occam.vault import Vault

KNOWN = {"palette", "search", "newNote", "quickAdd"}


@pytest.fixture
def vault(tmp_path: Path) -> Vault:
    v = Vault(tmp_path / "vault")
    v.ensure()
    return v


def test_parse_spec():
    assert keys.parse_spec("mod+k") == {
        "key": "k", "mod": True, "shift": False, "alt": False
    }
    assert keys.parse_spec("mod+shift+alt+f")["alt"] is True
    assert keys.parse_spec("K")["key"] == "k"  # case insensitive


@pytest.mark.parametrize("bad", ["", "   ", "mod+", "ctrl+k", "meta+shift+k"])
def test_parse_spec_rejects_nonsense(bad):
    assert keys.parse_spec(bad) is None


def test_no_file_means_defaults(vault: Vault):
    result = keys.load(vault, KNOWN)
    assert result.overrides == {} and result.problems == []


def test_overrides_are_read(vault: Vault):
    vault.write_file(keys.PATH, 'palette = "mod+shift+p"\nnewNote = "mod+alt+n"\n')
    result = keys.load(vault, KNOWN)

    assert result.overrides["palette"] == {
        "key": "p", "mod": True, "shift": True, "alt": False
    }
    assert result.overrides["newNote"]["alt"] is True
    assert result.problems == []


def test_an_unknown_command_is_ignored_not_flagged(vault: Vault):
    """A name this version lacks is probably from a newer one, or since renamed.

    Neither deserves an error on every startup — it simply does nothing, and is recorded
    for a future "what is in my file that I cannot use" view.
    """
    vault.write_file(keys.PATH, 'palete = "mod+k"\n')
    result = keys.load(vault, KNOWN)

    assert result.overrides == {}
    assert result.problems == []
    assert result.unknown == ["palete"]


def test_real_mistakes_are_still_reported(vault: Vault):
    """Ignoring unknown names must not mean ignoring a binding that cannot work."""
    vault.write_file(keys.PATH, 'palette = "ctrl+k"\nsearch = "mod+f"\nnewNote = "mod+f"\n')
    result = keys.load(vault, KNOWN)

    assert any("cannot read" in p for p in result.problems)
    assert any("same keys" in p for p in result.problems)


def test_unbound_commands_are_listed_commented_out(vault: Vault):
    """A file showing only what is set tells you nothing about what else you could set."""
    keys.ensure_template(
        vault,
        {"palette": {"key": "k", "mod": True}, "rollover": {"key": "", "mod": True}},
    )
    body = vault.read_file(keys.PATH)

    assert 'palette = "mod+k"' in body
    assert '# rollover = ""' in body
    assert "Not bound to anything yet" in body


def test_an_unbound_command_can_be_bound_by_uncommenting(vault: Vault):
    keys.ensure_template(vault, {"rollover": {"key": "", "mod": True}})
    body = vault.read_file(keys.PATH).replace('# rollover = ""', 'rollover = "mod+shift+r"')
    vault.write_file(keys.PATH, body)

    result = keys.load(vault, {"rollover"})
    assert result.overrides["rollover"] == {
        "key": "r", "mod": True, "shift": True, "alt": False
    }


def test_an_unreadable_binding_is_reported(vault: Vault):
    vault.write_file(keys.PATH, 'palette = "ctrl+k"\n')
    result = keys.load(vault, KNOWN)
    assert result.overrides == {}
    assert any("cannot read" in p for p in result.problems)


def test_two_commands_on_the_same_keys_is_reported(vault: Vault):
    """Silently letting one win would make the loser look broken for no visible reason."""
    vault.write_file(keys.PATH, 'palette = "mod+k"\nsearch = "mod+k"\n')
    result = keys.load(vault, KNOWN)

    assert "palette" in result.overrides
    assert "search" not in result.overrides
    assert any("same keys as palette" in p for p in result.problems)


def test_a_broken_file_falls_back_to_defaults(vault: Vault):
    """A malformed file must not stop the app having keyboard shortcuts at all."""
    vault.write_file(keys.PATH, "this is not toml = = =\n")
    assert keys.load(vault, KNOWN).overrides == {}


def test_template_lists_defaults(vault: Vault):
    defaults = {
        "palette": {"key": "k", "mod": True},
        "search": {"key": "f", "mod": True, "shift": True},
    }
    keys.ensure_template(vault, defaults)
    body = vault.read_file(keys.PATH)

    assert 'palette = "mod+k"' in body
    assert 'search = "mod+shift+f"' in body
    assert "⌘ alone means you do it many times a day" in body


def test_template_never_overwrites_your_edits(vault: Vault):
    vault.write_file(keys.PATH, 'palette = "mod+shift+p"\n')
    keys.ensure_template(vault, {"palette": {"key": "k", "mod": True}})
    assert vault.read_file(keys.PATH) == 'palette = "mod+shift+p"\n'


def test_round_trip(vault: Vault):
    defaults = {"quickAdd": {"key": "t", "mod": True}}
    keys.ensure_template(vault, defaults)
    result = keys.load(vault, {"quickAdd"})
    assert result.overrides["quickAdd"]["key"] == "t"
    assert result.problems == []
