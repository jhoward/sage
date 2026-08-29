"""Meeting notes and follow-up extraction."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from occam import meetings
from occam.vault import Vault

RECAP = """AI-generated

Q4 planning sync
Attendees: Jim, Priya, Sam

- Priya to circulate the draft roadmap
- Jim to write up the override threshold decision
- Sam will chase legal on the vendor clause
- Jim owes Priya the risk classification numbers by Friday
"""


@pytest.fixture
def vault(tmp_path: Path) -> Vault:
    v = Vault(tmp_path / "vault")
    v.ensure()
    return v


def test_title_comes_from_the_first_real_line():
    assert meetings.derive_title(RECAP) == "Q4 planning sync"


def test_title_skips_recap_boilerplate():
    assert meetings.derive_title("Meeting Recap\n\nBudget review\n") == "Budget review"
    assert meetings.derive_title("# Notes\n\nStandup\n") == "Standup"


def test_title_falls_back_to_a_date():
    assert meetings.derive_title("\n\n  \n").startswith("Meeting 20")


def test_long_titles_are_trimmed_on_a_word():
    title = meetings.derive_title("A " + "very " * 40 + "long meeting name")
    assert len(title) <= meetings.MAX_TITLE + 1
    assert title.endswith("…")


def test_note_path_is_dated_and_slugged():
    assert meetings.note_path("Q4 planning sync", date(2026, 8, 28)) == (
        "notes/meetings/2026-08-28-q4-planning-sync.md"
    )


def test_two_meetings_the_same_day_do_not_collide():
    taken = {"notes/meetings/2026-08-28-standup.md"}
    assert meetings.note_path("Standup", date(2026, 8, 28), taken).endswith("standup-2.md")


def test_create_writes_the_recap_verbatim(vault: Vault):
    path, title = meetings.create(vault, RECAP, date(2026, 8, 28))
    body = vault.read_file(path)

    assert title == "Q4 planning sync"
    assert "# Q4 planning sync" in body
    assert "date: 2026-08-28" in body
    # The recap is kept exactly, so nothing is lost in transcription.
    assert "Sam will chase legal on the vendor clause" in body


def test_create_refuses_an_empty_clipboard(vault: Vault):
    with pytest.raises(ValueError, match="Nothing on the clipboard"):
        meetings.create(vault, "   \n  ")


def test_follow_up_prompt_names_the_person(vault: Vault):
    prompt = meetings.follow_up_prompt("notes/meetings/x.md", ["Jim", "Jim Howard"])
    assert '"Jim" or "Jim Howard"' in prompt
    assert "not actions owned by anyone else" in prompt
    assert "[[x]]" in prompt  # links back to the meeting


def test_follow_up_prompt_without_a_configured_name(vault: Vault):
    prompt = meetings.follow_up_prompt("notes/meetings/x.md", [])
    assert "the note's author" in prompt


def test_multi_word_boilerplate_is_skipped():
    """"AI-generated meeting notes" is three noise words; an earlier version kept it."""
    assert meetings.derive_title("AI-generated meeting notes\n\nQ4 planning\n") == "Q4 planning"
    assert meetings.derive_title("Automatic Meeting Summary\n\nStandup\n") == "Standup"
    assert meetings.derive_title("Notes by Copilot\n\nBudget review\n") == "Budget review"


def test_a_real_title_containing_a_noise_word_survives():
    """"Meeting cadence review" is about meetings — it is not boilerplate."""
    assert meetings.derive_title("Meeting cadence review\n") == "Meeting cadence review"
    assert meetings.derive_title("AI governance sync\n") == "AI governance sync"
