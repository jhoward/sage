"""Ask-the-vault: the read/write split, and applying proposals.

The safety model is that write tools have no implementation in the ask path — they are
collected, never executed. These tests exist to keep that true.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from sage import chat
from sage.config import Config
from sage.vault import Vault


@pytest.fixture
def vault(tmp_path: Path) -> Vault:
    v = Vault(tmp_path / "vault")
    v.ensure()
    v.write_file("notes/oversight.md", "# Oversight\n\nOverride rate under 2% is a smell.\n")
    v.write_file("notes/evals.md", "# Evals\n\nEvaluate on production-shaped data.\n")
    return v


class Block:
    def __init__(self, **kw):
        self.__dict__.update(kw)


class FakeClient:
    """Replays scripted responses and records what it was asked."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls: list[dict] = []
        outer = self

        class Messages:
            def create(self, **kwargs):
                outer.calls.append(kwargs)
                return outer.responses.pop(0)

        self.messages = Messages()


def text_only(body: str):
    return Block(content=[Block(type="text", text=body)], stop_reason="end_turn")


def with_tools(*calls, text=""):
    content = [Block(type="text", text=text)] if text else []
    content += [
        Block(type="tool_use", id=f"t{i}", name=n, input=a)
        for i, (n, a) in enumerate(calls)
    ]
    return Block(content=content, stop_reason="tool_use")


# ---- reads are executed ----------------------------------------------

def test_read_tools_run_and_feed_back(vault: Vault):
    client = FakeClient(
        with_tools(("read_note", {"path": "notes/oversight.md"})),
        text_only("Under 2%, per notes/oversight.md."),
    )
    answer = chat.ask(vault, [{"role": "user", "content": "override rate?"}], client=client)

    assert "2%" in answer.text
    assert answer.read == ["notes/oversight.md"]
    # The note's contents were fed back as a tool_result.
    second = client.calls[1]["messages"][-1]["content"][0]
    assert "smell" in second["content"]


def test_search_returns_hits(vault: Vault):
    client = FakeClient(
        with_tools(("search_notes", {"query": "production-shaped"})),
        text_only("See notes/evals.md."),
    )
    chat.ask(vault, [{"role": "user", "content": "evals?"}], client=client)
    result = client.calls[1]["messages"][-1]["content"][0]["content"]
    assert "notes/evals.md" in result


def test_unreadable_note_does_not_crash_the_loop(vault: Vault):
    client = FakeClient(
        with_tools(("read_note", {"path": "notes/missing.md"})),
        text_only("That note does not exist."),
    )
    answer = chat.ask(vault, [{"role": "user", "content": "?"}], client=client)
    assert "does not exist" in answer.text


# ---- writes are only ever proposed -----------------------------------

def test_write_tools_are_collected_not_executed(vault: Vault):
    before = vault.read_file("notes/oversight.md")
    client = FakeClient(
        with_tools(
            ("add_task", {"text": "Derive a threshold", "target": "backlog"}),
            ("replace_in_note", {"path": "notes/oversight.md", "old": "2%", "new": "5%"}),
        ),
        text_only("Proposed two changes."),
    )
    answer = chat.ask(vault, [{"role": "user", "content": "fix it"}], client=client)

    assert len(answer.proposals) == 2
    # Nothing on disk changed.
    assert vault.read_file("notes/oversight.md") == before
    # The backlog was never even created, let alone written to.
    assert not (vault.root / "todo/backlog.md").exists()


def test_replacements_are_flagged_destructive(vault: Vault):
    client = FakeClient(
        with_tools(
            ("append_to_note", {"path": "notes/evals.md", "text": "More."}),
            ("replace_in_note", {"path": "notes/evals.md", "old": "Evals", "new": "E"}),
        ),
        text_only("done"),
    )
    answer = chat.ask(vault, [{"role": "user", "content": "x"}], client=client)
    assert [p.destructive for p in answer.proposals] == [False, True]


def test_writes_can_be_disabled(vault: Vault):
    client = FakeClient(text_only("Just answering."))
    chat.ask(vault, [{"role": "user", "content": "?"}], client=client, allow_writes=False)
    names = {t["name"] for t in client.calls[0]["tools"]}
    assert names == {"search_notes", "read_note"}


def test_the_note_index_is_in_the_system_prompt(vault: Vault):
    client = FakeClient(text_only("ok"))
    chat.ask(vault, [{"role": "user", "content": "?"}], client=client)
    assert "notes/oversight.md" in client.calls[0]["system"]


def test_loop_is_bounded(vault: Vault):
    """A model that only ever calls tools must not spin forever."""
    forever = [with_tools(("read_note", {"path": "notes/evals.md"})) for _ in range(20)]
    client = FakeClient(*forever)
    chat.ask(vault, [{"role": "user", "content": "?"}], client=client)
    assert len(client.calls) == chat.MAX_TURNS


# ---- applying and undoing --------------------------------------------

def test_apply_add_task(vault: Vault):
    changed, snapshot = chat.apply_proposals(
        vault, [{"tool": "add_task", "args": {"text": "Do it", "target": "backlog"}}]
    )
    assert "Do it" in vault.read_file("todo/backlog.md")
    assert changed and snapshot


def test_apply_append(vault: Vault):
    chat.apply_proposals(
        vault,
        [{"tool": "append_to_note", "args": {"path": "notes/evals.md", "text": "Added."}}],
    )
    body = vault.read_file("notes/evals.md")
    assert body.rstrip().endswith("Added.")
    assert "production-shaped" in body  # original survives


def test_apply_replace(vault: Vault):
    chat.apply_proposals(
        vault,
        [{
            "tool": "replace_in_note",
            "args": {"path": "notes/oversight.md", "old": "2%", "new": "5%"},
        }],
    )
    assert "5%" in vault.read_file("notes/oversight.md")


def test_replace_refuses_when_the_text_moved(vault: Vault):
    """If the note changed under us, replacing blind would corrupt it."""
    with pytest.raises(ValueError, match="not found"):
        chat.apply_proposals(
            vault,
            [{
                "tool": "replace_in_note",
                "args": {"path": "notes/oversight.md", "old": "nonexistent", "new": "x"},
            }],
        )


def test_undo_restores_every_touched_file(vault: Vault):
    before = vault.read_file("notes/oversight.md")
    _, snapshot = chat.apply_proposals(
        vault,
        [
            {"tool": "replace_in_note",
             "args": {"path": "notes/oversight.md", "old": "2%", "new": "5%"}},
            {"tool": "append_to_note",
             "args": {"path": "notes/evals.md", "text": "Added."}},
        ],
    )
    assert "5%" in vault.read_file("notes/oversight.md")

    chat.undo(vault, snapshot)
    assert vault.read_file("notes/oversight.md") == before
    assert "Added." not in vault.read_file("notes/evals.md")


def test_undo_removes_a_file_that_did_not_exist(vault: Vault):
    _, snapshot = chat.apply_proposals(
        vault, [{"tool": "add_task", "args": {"text": "New", "target": "week"}}]
    )
    chat.undo(vault, snapshot)
    from sage import todo
    assert not (vault.root / todo.week_path()).exists()


def test_unknown_proposal_is_refused(vault: Vault):
    with pytest.raises(ValueError, match="unknown proposal"):
        chat.apply_proposals(vault, [{"tool": "rm_rf", "args": {}}])


# ---- synthesis into new notes ----------------------------------------

def test_create_note_is_additive(vault: Vault):
    proposals = [{
        "tool": "create_note",
        "args": {
            "path": "notes/override-threshold.md",
            "title": "Override threshold",
            "body": "Settled at 5%. Drawn from [[human-oversight]] and [[evals]].",
        },
    }]
    changed, snapshot = chat.apply_proposals(vault, proposals)

    body = vault.read_file("notes/override-threshold.md")
    assert body.startswith("# Override threshold")
    assert "[[human-oversight]]" in body
    assert changed == ["notes/override-threshold.md: created"]
    # Snapshot records that the file did not exist, so undo deletes it.
    assert snapshot["notes/override-threshold.md"] == ""


def test_undo_removes_a_created_note(vault: Vault):
    _, snapshot = chat.apply_proposals(vault, [{
        "tool": "create_note",
        "args": {"path": "notes/new.md", "title": "New", "body": "From [[evals]]."},
    }])
    assert (vault.root / "notes/new.md").exists()

    chat.undo(vault, snapshot)
    assert not (vault.root / "notes/new.md").exists()


def test_create_note_refuses_to_overwrite(vault: Vault):
    with pytest.raises(ValueError, match="already exists"):
        chat.apply_proposals(vault, [{
            "tool": "create_note",
            "args": {"path": "notes/evals.md", "title": "Evals", "body": "x"},
        }])


def test_create_note_appends_md(vault: Vault):
    chat.apply_proposals(vault, [{
        "tool": "create_note",
        "args": {"path": "notes/no-extension", "title": "T", "body": "b"},
    }])
    assert (vault.root / "notes/no-extension.md").exists()


def test_create_note_does_not_double_the_heading(vault: Vault):
    chat.apply_proposals(vault, [{
        "tool": "create_note",
        "args": {"path": "notes/x.md", "title": "T", "body": "# Already has one\n\nBody"},
    }])
    body = vault.read_file("notes/x.md")
    assert body.count("#") == 1


def test_create_note_is_not_destructive(vault: Vault):
    """Creating a file is undone by deleting it, so it should not require extra ceremony."""
    client = FakeClient(
        with_tools(("create_note", {"path": "notes/s.md", "title": "S", "body": "b"})),
        text_only("Proposed a note."),
    )
    answer = chat.ask(vault, [{"role": "user", "content": "capture that"}], client=client)
    assert answer.proposals[0].destructive is False
    assert not (vault.root / "notes/s.md").exists()  # still only a proposal
