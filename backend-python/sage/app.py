"""HTTP surface.

Routes mirror the VaultBackend contract in frontend/src/backend/types.ts one-for-one.
That correspondence is deliberate: it is what lets a Rust backend later satisfy the same
interface without the frontend noticing.

SyncStatus is included in responses from day one even though it always reads "local", so
the UI has its indicator slot and needs no restructuring when git sync lands.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from fastapi.responses import StreamingResponse

from . import ai, config as config_mod
from . import links as links_mod
from . import skills as skills_mod
from . import todo, vault_sync
from .vault import Vault, VaultError


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


class WriteRequest(BaseModel):
    path: str
    content: str


class QuickAddRequest(BaseModel):
    text: str
    target: str = "week"  # or "backlog"


class RenameRequest(BaseModel):
    path: str
    newPath: str


class SkillRunRequest(BaseModel):
    skill: str
    notePath: str | None = None
    selection: str | None = None
    instruction: str | None = None


class MoveRequest(BaseModel):
    source: str
    line: int
    target: str
    heading: str | None = None


def create_app(
    vault: Vault | None = None,
    sync=None,
    static_dir: Path | None = None,
    cfg=None,
    ai_client=None,
):
    # Config is loaded whenever it was not supplied — including when a vault *was*.
    # Scoping this to `vault is None` meant the real app, which always builds its own
    # vault, ran with cfg=None and could never see the API key. Tests passed because they
    # pass cfg explicitly, which is a path the app itself never takes.
    cfg = cfg or config_mod.load()
    if vault is None:
        vault = Vault(cfg.vault_path)
        vault.ensure()
    sync = sync or vault_sync.make(cfg.sync, vault.root)
    skills_mod.ensure_default_skills(vault)

    app = FastAPI(title="sage", docs_url=None, redoc_url=None)
    app.state.vault = vault
    app.state.sync = sync

    @app.exception_handler(VaultError)
    async def _vault_error(_request, exc: VaultError):
        raise HTTPException(status_code=400, detail=str(exc))

    def guard(fn, *args):
        try:
            return fn(*args)
        except VaultError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/files")
    def list_files(hidden: bool = False):
        return {
            "files": [n.to_dict() for n in vault.list_files(include_hidden=hidden)],
            "sync": sync.status().to_dict(),
        }

    @app.get("/api/file")
    def read_file(path: str):
        return {"path": path, "content": guard(vault.read_file, path)}

    @app.put("/api/file")
    def write_file(req: WriteRequest):
        guard(vault.write_file, req.path, req.content)
        return {"ok": True, "sync": sync.status().to_dict()}

    @app.post("/api/rename")
    def rename(req: RenameRequest):
        """Move a note and repoint every link that referenced it."""
        try:
            return links_mod.rename(vault, req.path, req.newPath).to_dict()
        except (ValueError, VaultError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/search")
    def search(q: str = ""):
        return {"hits": [h.to_dict() for h in vault.search(q)]}

    @app.get("/api/sync")
    def sync_status():
        return sync.status().to_dict()

    @app.get("/api/todo/week")
    def todo_week():
        """This week's file, created on first access."""
        path = todo.ensure_week_files(vault)
        return {
            "path": path,
            "week": todo.week_id(),
            "backlogs": todo.backlog_paths(vault.root),
        }

    @app.get("/api/todo/backlog")
    def backlog_tasks():
        """Open tasks across every backlog file, for pull-from-backlog in the palette."""
        out = []
        for path in todo.backlog_paths(vault.root):
            for t in todo.parse_tasks(vault.read_file(path)):
                if not t.done:
                    out.append(
                        {
                            "path": path,
                            "line": t.line,
                            "text": t.text,
                            "section": t.section,
                            "rolled": t.rolled,
                        }
                    )
        return {"tasks": out}

    @app.post("/api/todo/rollover")
    def rollover():
        """Carry unfinished work forward. Deterministic — no model involved."""
        return guard(todo.rollover, vault).to_dict()

    @app.post("/api/todo/move")
    def move(req: MoveRequest):
        try:
            task = todo.move_task(vault, req.source, req.line, req.target, req.heading)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except VaultError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"ok": True, "text": task.text, "target": req.target}

    @app.post("/api/todo/quick-add")
    def quick_add(req: QuickAddRequest):
        if not req.text.strip():
            raise HTTPException(status_code=400, detail="empty task")
        path = todo.append_task(vault, req.text, req.target)
        return {"ok": True, "path": path}

    @app.get("/api/config")
    def config_info():
        """Where machine-local config lives, and whether a key is set.

        The config file sits outside the vault, so the editor cannot open it — the vault
        API refuses paths beyond its root, correctly. Hence a route that reports the path
        and one that hands it to the OS.
        """
        return {
            "path": str(config_mod.CONFIG_PATH),
            "hasKey": ai.api_key(cfg) is not None,
            "keyFromEnv": bool(os.environ.get("ANTHROPIC_API_KEY")),
        }

    @app.post("/api/config/open")
    def open_config():
        """Hand the config file to the OS default editor."""
        path = config_mod.CONFIG_PATH
        if not path.exists():
            config_mod.Config(vault_path=vault.root).save(path)

        opener = {"darwin": ["open"], "win32": ["cmd", "/c", "start", ""]}.get(
            sys.platform, ["xdg-open"]
        )
        try:
            subprocess.Popen([*opener, str(path)])
        except OSError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        return {"ok": True, "path": str(path)}

    @app.get("/api/skills")
    def list_skills():
        """Skills are vault files, so this is re-read rather than cached — editing a
        prompt in the editor takes effect on the next palette open."""
        return {
            "skills": [s.to_dict() for s in skills_mod.load_skills(vault)],
            "available": ai.api_key(cfg) is not None or ai_client is not None,
        }

    @app.post("/api/skills/run")
    def run_skill(req: SkillRunRequest):
        skill = next(
            (s for s in skills_mod.load_skills(vault) if s.id == req.skill), None
        )
        if skill is None:
            raise HTTPException(status_code=404, detail=f"no skill {req.skill!r}")

        request = ai.SkillRequest(
            skill=skill,
            note_path=req.notePath,
            selection=req.selection,
            instruction=req.instruction,
        )

        def events():
            """Server-sent events: one `chunk` per piece of text, then `done`.

            Errors are streamed as an `error` event rather than raised, because by the
            time the first byte is out an HTTP status can no longer be changed.
            """
            try:
                for piece in ai.stream_skill(vault, request, cfg, ai_client):
                    yield _sse("chunk", {"text": piece})
                yield _sse("done", {"mode": skill.mode, "skill": skill.id})
            except ai.AIUnavailable as exc:
                yield _sse("error", {"message": str(exc)})
            except Exception as exc:  # surface API failures in the UI, not the console
                yield _sse("error", {"message": f"{type(exc).__name__}: {exc}"})

        return StreamingResponse(
            events(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # Built frontend assets, when running as a packaged app rather than against Vite.
    if static_dir and static_dir.is_dir():
        app.mount(
            "/assets",
            StaticFiles(directory=static_dir / "assets"),
            name="assets",
        )

        @app.get("/{full_path:path}")
        def spa(full_path: str):
            return FileResponse(static_dir / "index.html")

    return app
