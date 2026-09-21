"""The settings screen's backend."""

from __future__ import annotations

import stat
import subprocess
import time
import urllib.error
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from occam import config as config_mod
from occam import settings
from occam.app import create_app
from occam.vault import Vault

KEY = "sk-test-SECRET-value"


@pytest.fixture
def env(tmp_path: Path, monkeypatch):
    """An app whose config file lives in tmp, never the real one."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    path = tmp_path / "config.toml"
    monkeypatch.setattr(config_mod, "CONFIG_PATH", path)

    vault = Vault(tmp_path / "vault")
    vault.ensure()
    cfg = config_mod.Config(vault_path=vault.root, anthropic_api_key=KEY, me=["Jim"])
    cfg.save(path)
    return TestClient(create_app(vault, cfg=cfg)), cfg, path, vault


# ---- the key never comes back -------------------------------------------

def test_the_api_key_is_never_sent_to_the_screen(env):
    client, *_ = env
    body = client.get("/api/settings")
    assert body.json()["apiKeySet"] is True
    assert KEY not in body.text


def test_saving_other_settings_neither_returns_nor_loses_the_key(env):
    client, cfg, path, _ = env
    r = client.put("/api/settings", json={"me": ["Jim", "James"], "apiKey": ""})

    assert r.status_code == 200 and KEY not in r.text
    assert cfg.anthropic_api_key == KEY          # an empty field means "unchanged"
    assert config_mod.load(path).anthropic_api_key == KEY
    assert config_mod.load(path).me == ["Jim", "James"]


def test_the_key_can_be_replaced_and_cleared(env):
    client, cfg, path, _ = env
    client.put("/api/settings", json={"apiKey": "  sk-new-one  "})
    assert cfg.anthropic_api_key == "sk-new-one"
    assert config_mod.load(path).anthropic_api_key == "sk-new-one"

    r = client.put("/api/settings", json={"clearApiKey": True})
    assert r.json()["apiKeySet"] is False
    assert config_mod.load(path).anthropic_api_key is None


def test_a_key_mangled_in_the_paste_is_refused(env):
    client, cfg, *_ = env
    assert client.put("/api/settings", json={"apiKey": "sk-abc def"}).status_code == 400
    assert cfg.anthropic_api_key == KEY


def test_an_environment_key_is_reported_as_the_one_in_use(env, monkeypatch):
    client, *_ = env
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-from-env")
    assert client.get("/api/settings").json()["apiKeyFromEnv"] is True


# ---- the file ----------------------------------------------------------

def test_the_config_file_is_private_after_a_save(env):
    client, _, path, _ = env
    path.chmod(0o644)  # as it once was, with a key in it
    client.put("/api/settings", json={"me": ["Jim"]})
    assert stat.S_IMODE(path.stat().st_mode) == 0o600


def test_comments_in_the_file_survive_a_save(env):
    client, _, path, _ = env
    path.write_text(path.read_text() + "\n# a note to myself\n")
    client.put("/api/settings", json={"workspaceId": "wrkspc_abc"})

    text = path.read_text()
    assert "# a note to myself" in text
    assert "# Where your notes live." in text
    assert config_mod.load(path).anthropic_workspace_id == "wrkspc_abc"


def test_a_windows_path_survives_the_round_trip(env):
    _, cfg, path, _ = env
    config_mod.update(cfg, {"vault_path": Path(r"C:\Users\me\notes")}, path)
    assert str(config_mod.load(path).vault_path) == r"C:\Users\me\notes"


# ---- what applies when -------------------------------------------------

def test_names_and_workspace_apply_without_a_restart(env):
    client, cfg, *_ = env
    r = client.put("/api/settings", json={"me": ["Jim H"], "workspaceId": "wrkspc_x"})
    assert r.json()["restartNeeded"] is False
    # The routes read this object on every request, so this is "live".
    assert cfg.me == ["Jim H"] and cfg.anthropic_workspace_id == "wrkspc_x"


def test_only_the_vault_folder_needs_a_restart(env, tmp_path: Path):
    client, *_ = env
    r = client.put("/api/settings", json={"vaultPath": str(tmp_path / "elsewhere")})
    assert r.json()["restartNeeded"] is True
    assert r.json()["vaultPath"].endswith("elsewhere")


def test_turning_backup_on_starts_it_at_once(env):
    client, _, _, vault = env
    (vault.root / "a.md").write_text("# A\n")

    r = client.put("/api/settings", json={"sync": "git"})
    assert r.json()["restartNeeded"] is False

    deadline = time.time() + 10   # startup runs on its own thread
    while time.time() < deadline and not (vault.root / ".git").is_dir():
        time.sleep(0.05)
    assert (vault.root / ".git").is_dir()

    while time.time() < deadline:
        status = client.get("/api/sync").json()
        if status["detail"] == "local history only":
            break
        time.sleep(0.05)
    assert status["backend"] == "git" and status["state"] == "ok"
    log = subprocess.run(["git", "log", "--oneline"], cwd=vault.root, capture_output=True, text=True)
    assert log.stdout.strip()


def test_turning_backup_off_again_works_too(env):
    client, *_ = env
    client.put("/api/settings", json={"sync": "git"})
    client.put("/api/settings", json={"sync": "local"})
    assert client.get("/api/sync").json()["backend"] == "local"


# ---- validation --------------------------------------------------------

@pytest.mark.parametrize("bad", [
    "--upload-pack=touch /tmp/pwned",   # would be read by git as an option
    "-oProxyCommand=evil",
    "not a remote",
    "git@github.com:you/notes.git; rm -rf ~",
])
def test_a_remote_that_could_be_read_as_an_option_is_refused(env, bad):
    client, cfg, *_ = env
    assert client.put("/api/settings", json={"syncRemote": bad}).status_code == 400
    assert client.post("/api/settings/check-remote", json={"remote": bad}).status_code == 400
    assert cfg.sync_remote is None


@pytest.mark.parametrize("good", [
    "git@github.com:jhoward/notes.git",
    "https://github.com/jhoward/notes.git",
    "ssh://git@example.com:2222/notes.git",
    "/Volumes/backup/notes.git",
])
def test_ordinary_remotes_are_accepted(good):
    assert settings.clean_remote(f"  {good} ") == good


def test_an_empty_remote_means_none():
    assert settings.clean_remote("   ") is None


def test_bad_values_are_explained_not_applied(env):
    client, cfg, *_ = env
    assert client.put("/api/settings", json={"sync": "dropbox"}).status_code == 400
    assert client.put("/api/settings", json={"vaultPath": "relative/path"}).status_code == 400
    assert client.put("/api/settings", json={"vaultPath": ""}).status_code == 400
    assert cfg.sync == "local"


def test_a_vault_path_that_is_a_file_is_refused(env, tmp_path: Path):
    client, *_ = env
    f = tmp_path / "a-file"
    f.write_text("x")
    r = client.put("/api/settings", json={"vaultPath": str(f)})
    assert r.status_code == 400 and "file" in r.json()["detail"]


# ---- checking a remote -------------------------------------------------

def _answers(code: int | None):
    def opener(request, timeout=0):
        if code is None:
            raise OSError("offline")
        if code == 200:
            class Ok:
                def __enter__(self): return self
                def __exit__(self, *a): return False
            return Ok()
        raise urllib.error.HTTPError(request.full_url, code, "", {}, None)
    return opener


def test_a_repository_the_public_can_see_is_called_public():
    remote = "git@github.com:jhoward/sage.git"
    assert settings.github_visibility(remote, _answers(200)) == "public"
    assert settings.github_visibility(remote, _answers(404)) == "private"
    assert settings.github_visibility(remote, _answers(None)) == "unknown"
    assert settings.github_visibility("/local/path.git", _answers(200)) == "unknown"


def test_it_asks_about_the_right_repository():
    seen = []
    def opener(request, timeout=0):
        seen.append(request.full_url)
        raise urllib.error.HTTPError(request.full_url, 404, "", {}, None)
    for remote in ("git@github.com:jhoward/notes.git", "https://github.com/jhoward/notes"):
        settings.github_visibility(remote, opener)
    assert seen == ["https://github.com/jhoward/notes"] * 2


def test_a_reachable_local_remote(tmp_path: Path):
    bare = tmp_path / "r.git"
    subprocess.run(["git", "init", "--bare", str(bare)], check=True, capture_output=True)
    result = settings.check_remote(str(bare), _answers(None))
    assert result["reachable"] is True and result["visibility"] == "unknown"


def test_an_unreachable_remote_is_not_called_private(tmp_path: Path):
    # 404 from GitHub and no answer to git: missing or no access, not "safely private".
    result = settings.check_remote(str(tmp_path / "nowhere.git"), _answers(404))
    assert result["reachable"] is False and result["visibility"] == "unknown"


def test_a_public_remote_is_said_loudly(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "github_visibility", lambda *_: "public")
    bare = tmp_path / "r.git"
    subprocess.run(["git", "init", "--bare", str(bare)], check=True, capture_output=True)
    assert "PUBLIC" in settings.check_remote(str(bare))["detail"]
