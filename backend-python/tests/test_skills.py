"""Skills, context strategies, and the streaming route.

Every test here uses a fake client. Nothing in the suite calls the real API, so running
the tests costs nothing and needs no key.
"""

from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path

import pytest

from sage import ai, context, skills
from sage.app import create_app
from sage.config import Config
from sage.vault import Vault


@pytest.fixture
def vault(tmp_path: Path) -> Vault:
    v = Vault(tmp_path / "vault")
    v.ensure()
    return v


class FakeStream:
    def __init__(self, chunks): self._chunks = chunks
    def __enter__(self): return self
    def __exit__(self, *a): return False
    @property
    def text_stream(self): return iter(self._chunks)


class FakeClient:
    """Records the request and replays canned chunks."""

    def __init__(self, chunks=("Cleaned ", "text.")):
        self.chunks = chunks
        self.calls: list[dict] = []
        outer = self

        class Messages:
            @contextmanager
            def stream(self, **kwargs):
                outer.calls.append(kwargs)
                yield FakeStream(outer.chunks)

        self.messages = Messages()


# ---- parsing ---------------------------------------------------------

def test_parse_frontmatter_splits_meta_and_body():
    meta, body = skills.parse_frontmatter("---\ntitle: Clean up\nmode: replace\n---\nDo it.")
    assert meta == {"title": "Clean up", "mode": "replace"}
    assert body == "Do it."


def test_parse_frontmatter_without_frontmatter():
    assert skills.parse_frontmatter("Just a prompt.") == ({}, "Just a prompt.")


def test_parse_skill_defaults(vault: Vault):
    s = skills.parse_skill(".sage/skills/tighten.md", "Make it shorter.")
    assert s.id == "tighten"
    assert s.title == "Tighten"  # derived from the filename
    assert s.context == "selection" and s.mode == "replace"


def test_parse_skill_falls_back_on_a_bad_value():
    """A typo must not make a skill vanish from the palette with no explanation."""
    s = skills.parse_skill("x.md", "---\ntitle: T\ncontext: nonsense\n---\nBody")
    assert s.context == "selection"


def test_parse_skill_without_a_body_is_ignored():
    assert skills.parse_skill("x.md", "---\ntitle: Empty\n---\n") is None


def test_default_skills_are_written_once(vault: Vault):
    written = skills.ensure_default_skills(vault)
    assert set(written) == set(skills.DEFAULTS)

    vault.write_file(".sage/skills/cleanup.md", "---\ntitle: Mine\n---\nEdited")
    assert skills.ensure_default_skills(vault) == []  # never overwrites
    assert "Edited" in vault.read_file(".sage/skills/cleanup.md")


def test_load_skills_sorted_by_title(vault: Vault):
    skills.ensure_default_skills(vault)
    loaded = skills.load_skills(vault)
    assert [s.title for s in loaded] == sorted(s.title for s in loaded)
    assert {s.id for s in loaded} == {"ask", "cleanup", "expand", "weekly-summary"}


# ---- context strategies ----------------------------------------------

def test_selection_strategy(vault: Vault):
    assert context.get("selection").build(vault, None, "just this") == "just this"


def test_note_strategy_includes_the_path(vault: Vault):
    vault.write_file("notes/a.md", "Body text")
    out = context.get("note").build(vault, "notes/a.md", None)
    assert "notes/a.md" in out and "Body text" in out


def test_note_and_links_pulls_in_linked_notes(vault: Vault):
    vault.write_file("notes/a.md", "See [[b]] and [[missing]].")
    vault.write_file("notes/b.md", "Linked body")
    out = context.get("note-and-links").build(vault, "notes/a.md", None)

    assert "Linked body" in out
    assert "notes/b.md" in out
    assert "missing" not in out.replace("[[missing]]", "")  # unresolved link is skipped


def test_note_and_links_skips_ambiguous_names(vault: Vault):
    """Two notes share a basename; guessing between them would be worse than skipping."""
    vault.write_file("notes/a.md", "See [[dup]].")
    vault.write_file("notes/dup.md", "First")
    vault.write_file("archive/dup.md", "Second")
    out = context.get("note-and-links").build(vault, "notes/a.md", None)
    assert "First" not in out and "Second" not in out


def test_week_done_sends_only_completed_tasks(vault: Vault):
    vault.write_file(
        "todo/2026-W35.md",
        "## Now\n- [x] Shipped it\n- [ ] Still open\n- [X] Also done\n",
    )
    out = context.get("week-done").build(vault, "todo/2026-W35.md", None)

    assert "Shipped it" in out and "Also done" in out
    assert "Still open" not in out  # intentions must not drift into a report of the week


# ---- prompt assembly -------------------------------------------------

def test_build_prompt_includes_skill_and_context(vault: Vault):
    vault.write_file("notes/a.md", "Note body")
    skill = skills.parse_skill("x.md", "---\ncontext: note\n---\nDo the thing.")
    prompt = ai.build_prompt(vault, ai.SkillRequest(skill, note_path="notes/a.md"))

    assert prompt.startswith("Do the thing.")
    assert "Note body" in prompt


def test_build_prompt_keeps_the_selection_distinguishable(vault: Vault):
    vault.write_file("notes/a.md", "Full note body")
    skill = skills.parse_skill("x.md", "---\ncontext: note\n---\nExpand.")
    prompt = ai.build_prompt(
        vault, ai.SkillRequest(skill, note_path="notes/a.md", selection="this bit")
    )
    assert "# Selected text" in prompt and "this bit" in prompt


# ---- streaming -------------------------------------------------------

def test_stream_skill_uses_the_skill_model_and_effort(vault: Vault):
    skills.ensure_default_skills(vault)
    skill = next(s for s in skills.load_skills(vault) if s.id == "cleanup")
    client = FakeClient()

    out = "".join(ai.stream_skill(vault, ai.SkillRequest(skill, selection="x"), client=client))

    assert out == "Cleaned text."
    call = client.calls[0]
    assert call["model"] == "claude-opus-5"
    assert call["output_config"] == {"effort": "low"}
    assert call["max_tokens"] == ai.MAX_TOKENS


def test_stream_skill_without_a_key_is_actionable(vault: Vault):
    skill = skills.parse_skill("x.md", "Body")
    with pytest.raises(ai.AIUnavailable, match="ANTHROPIC_API_KEY"):
        list(ai.stream_skill(vault, ai.SkillRequest(skill), cfg=Config(vault.root)))


# ---- routes ----------------------------------------------------------

def _client(vault: Vault, ai_client=None):
    from fastapi.testclient import TestClient

    return TestClient(
        create_app(vault, cfg=Config(vault.root), ai_client=ai_client)
    )


def test_skills_route_reports_availability(vault: Vault):
    body = _client(vault).get("/api/skills").json()
    assert {s["id"] for s in body["skills"]} == set(
        Path(n).stem for n in skills.DEFAULTS
    )
    assert body["available"] is False  # no key configured in the test env


def test_run_skill_streams_chunks_then_done(vault: Vault):
    r = _client(vault, FakeClient(("Hello ", "world"))).post(
        "/api/skills/run", json={"skill": "cleanup", "selection": "hi"}
    )
    assert r.status_code == 200
    assert 'data: {"text": "Hello "}' in r.text
    assert 'data: {"text": "world"}' in r.text
    assert "event: done" in r.text


def test_run_skill_streams_an_error_rather_than_failing_the_response(vault: Vault):
    """Once the first byte is out the status cannot change, so errors ride the stream."""
    r = _client(vault).post("/api/skills/run", json={"skill": "cleanup"})
    assert r.status_code == 200
    assert "event: error" in r.text
    assert "ANTHROPIC_API_KEY" in r.text


def test_run_unknown_skill_is_404(vault: Vault):
    assert _client(vault).post("/api/skills/run", json={"skill": "nope"}).status_code == 404


# ---- config discoverability -----------------------------------------

def test_new_config_documents_the_api_key(tmp_path: Path):
    """The file should teach you what is available, including the empty settings."""
    from sage import config as config_mod

    path = tmp_path / "config.toml"
    cfg = config_mod.load(path)

    body = path.read_text()
    assert 'anthropic_api_key = ""' in body
    assert "ANTHROPIC_API_KEY in the environment takes precedence" in body
    assert cfg.anthropic_api_key is None


def test_config_round_trips_through_the_template(tmp_path: Path):
    from sage import config as config_mod

    path = tmp_path / "config.toml"
    config_mod.Config(tmp_path / "vault", "local", "sk-test-123").save(path)

    assert config_mod.load(path).anthropic_api_key == "sk-test-123"


def test_config_escapes_a_windows_style_path(tmp_path: Path):
    from sage import config as config_mod

    path = tmp_path / "config.toml"
    config_mod.Config(Path(r"C:\Users\me\notes")).save(path)
    assert "C:\\\\Users" in path.read_text()  # escaped for TOML
    assert config_mod.load(path).vault_path == Path(r"C:\Users\me\notes")


def test_config_route_reports_where_the_key_goes(vault: Vault):
    body = _client(vault).get("/api/config").json()
    assert body["path"].endswith("config.toml")
    assert body["hasKey"] is False


def test_create_app_loads_config_even_when_given_a_vault(tmp_path: Path, monkeypatch):
    """Regression: cfg was only loaded when `vault is None`.

    The real app always builds its own vault and passes it in, so it ran with cfg=None
    and could never see the API key. The tests missed it because they pass cfg
    explicitly — a path the app itself never takes.
    """
    from fastapi.testclient import TestClient

    from sage import config as config_mod

    cfg_path = tmp_path / "config.toml"
    config_mod.Config(tmp_path / "vault", "local", "sk-test-key").save(cfg_path)
    monkeypatch.setattr(config_mod, "CONFIG_PATH", cfg_path)

    v = Vault(tmp_path / "vault")
    v.ensure()
    body = TestClient(create_app(v)).get("/api/config").json()

    assert body["hasKey"] is True


# ---- identity-linked keys -------------------------------------------

def test_workspace_id_is_sent_as_a_header(vault: Vault, monkeypatch):
    """Identity-linked keys need a workspace; the SDK has no parameter for it."""
    import anthropic

    from sage import config as config_mod

    captured = {}

    def fake_client(**kwargs):
        captured.update(kwargs)
        return FakeClient()

    monkeypatch.setattr(anthropic, "Anthropic", fake_client)
    skills.ensure_default_skills(vault)
    skill = next(s for s in skills.load_skills(vault) if s.id == "cleanup")
    cfg = config_mod.Config(vault.root, "local", "sk-test", "wrkspc_123")

    list(ai.stream_skill(vault, ai.SkillRequest(skill, selection="x"), cfg=cfg))

    assert captured["default_headers"] == {"anthropic-workspace-id": "wrkspc_123"}


def test_no_workspace_header_when_unset(vault: Vault, monkeypatch):
    import anthropic

    from sage import config as config_mod

    captured = {}
    monkeypatch.setattr(
        anthropic, "Anthropic", lambda **kw: (captured.update(kw), FakeClient())[1]
    )
    skills.ensure_default_skills(vault)
    skill = next(s for s in skills.load_skills(vault) if s.id == "cleanup")

    list(
        ai.stream_skill(
            vault,
            ai.SkillRequest(skill, selection="x"),
            cfg=config_mod.Config(vault.root, "local", "sk-test"),
        )
    )
    assert captured["default_headers"] is None


def test_missing_workspace_error_names_the_setting(vault: Vault):
    """The API says which header is missing; the user needs to know which setting to edit."""

    class Boom:
        class messages:
            @staticmethod
            def stream(**kwargs):
                raise RuntimeError(
                    "Error code: 400 - anthropic-workspace-id is required when "
                    "authenticating with an identity-linked API key"
                )

    skills.ensure_default_skills(vault)
    skill = next(s for s in skills.load_skills(vault) if s.id == "cleanup")

    with pytest.raises(ai.AIUnavailable, match="anthropic_workspace_id"):
        list(ai.stream_skill(vault, ai.SkillRequest(skill, selection="x"), client=Boom()))


def test_config_round_trips_the_workspace_id(tmp_path: Path):
    from sage import config as config_mod

    path = tmp_path / "config.toml"
    config_mod.Config(tmp_path / "v", "local", "sk-x", "wrkspc_9").save(path)
    assert config_mod.load(path).anthropic_workspace_id == "wrkspc_9"
    assert 'anthropic_workspace_id = ""' not in path.read_text()
