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


# A recap with no name of its own, so the model is the only source of a title.
UNNAMED = (
    "Meeting summary\n\n"
    "We went back and forth on whether the audit trail retention of 18 months is "
    "defensible. Jim to derive it from investigation need rather than asserting it.\n"
)


class FakeTitleClient:
    def __init__(self, title="Q4 governance planning"):
        outer = self

        class Block:
            type = "text"
            text = title

        class Messages:
            def create(self, **kwargs):
                outer.kwargs = kwargs
                return type("R", (), {"content": [Block()]})()

        self.messages = Messages()


class BrokenClient:
    class messages:
        @staticmethod
        def create(**kwargs):
            raise RuntimeError("network down")


def test_model_title_is_used_when_the_recap_has_no_name(vault: Vault):
    _, title = meetings.create(
        vault, UNNAMED, date(2026, 8, 28), client=FakeTitleClient()
    )
    assert title == "Q4 governance planning"


def test_falls_back_to_the_heuristic_when_the_call_fails(vault: Vault):
    """A title is never worth failing the paste over."""
    _, title = meetings.create(vault, UNNAMED, date(2026, 8, 28), client=BrokenClient())
    assert title.startswith("We went back")  # falls back to the first real line


def test_falls_back_when_there_is_no_key(vault: Vault):
    from occam.config import Config

    _, title = meetings.create(vault, UNNAMED, date(2026, 8, 28), cfg=Config(vault.root))
    assert title.startswith("We went back")


def test_model_title_is_asked_cheaply(vault: Vault):
    client = FakeTitleClient()
    meetings.create(vault, UNNAMED, date(2026, 8, 28), client=client)
    assert client.kwargs["output_config"] == {"effort": "low"}
    assert client.kwargs["max_tokens"] <= 64


def test_model_title_quotes_are_stripped(vault: Vault):
    _, title = meetings.create(
        vault, UNNAMED, date(2026, 8, 28), client=FakeTitleClient('"Budget review"')
    )
    assert title == "Budget review"


def test_a_named_meeting_keeps_its_name_without_asking(vault: Vault):
    """The model reliably rewrites a name it was told to reuse, so it is not asked."""
    client = FakeTitleClient("Something The Model Invented")
    _, title = meetings.create(vault, RECAP, date(2026, 8, 28), client=client)

    assert title == "Q4 planning sync"
    assert not hasattr(client, "kwargs")  # never called


def test_an_unnamed_recap_asks_the_model(vault: Vault):
    prose = (
        "Meeting summary\n\n"
        "We went back and forth on whether the audit trail retention of 18 months is "
        "defensible, and Jim agreed to derive it properly.\n"
    )
    client = FakeTitleClient("Audit trail retention")
    _, title = meetings.create(vault, prose, date(2026, 8, 28), client=client)

    assert title == "Audit trail retention"
    assert hasattr(client, "kwargs")


def test_looks_like_a_name():
    assert meetings.looks_like_a_name("Q4 planning sync")
    assert not meetings.looks_like_a_name("We discussed the retention period at length.")
    assert not meetings.looks_like_a_name("Attendees:")
    assert not meetings.looks_like_a_name(
        "A rambling first line that goes on well past the length of any real title"
    )


def test_label_lines_are_not_titles():
    """"Attendees: Jim, Priya" survived a check that every word be boilerplate."""
    recap = "Meeting notes\n\nAttendees: Jim, Priya\n\nBudget review\n"
    assert meetings.derive_title(recap) == "Budget review"

    for label in ["Participants: Sam", "Agenda: three items", "Date: 28 Aug"]:
        assert meetings.derive_title(f"{label}\n\nReal title\n") == "Real title"


def test_a_colon_inside_a_real_title_is_kept():
    assert meetings.derive_title("Q4 planning: scope and budget\n") == (
        "Q4 planning: scope and budget"
    )


def test_slug_is_capped_so_filenames_stay_scannable():
    """The note keeps the full title; the filename should read like a hand-named one."""
    assert meetings.slug("Review of the vendor contract clauses for Q4") == (
        "review-vendor-contract-clauses"
    )
    assert meetings.slug("Q4 planning: scope and budget") == "q4-planning-scope-budget"


def test_slug_drops_stopwords_but_never_everything():
    assert meetings.slug("The and of") == "the-and-of"  # all stopwords: keep them
    assert meetings.slug("Standup") == "standup"


def test_slug_matches_the_style_already_in_the_vault():
    assert meetings.slug("AI risk forum") == "ai-risk-forum"
    assert meetings.slug("Vendor review") == "vendor-review"


def test_note_path_stays_short(vault: Vault):
    path = meetings.note_path(
        "Review of the vendor contract clauses for Q4", date(2026, 8, 28)
    )
    assert path == "notes/meetings/2026-08-28-review-vendor-contract-clauses.md"
