"""HTTP surface.

Routes mirror the VaultBackend contract in frontend/src/backend/types.ts one-for-one.
That correspondence is deliberate: it is what lets a Rust backend later satisfy the same
interface without the frontend noticing.

SyncStatus is included in responses from day one even though it always reads "local", so
the UI has its indicator slot and needs no restructuring when git sync lands.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import config as config_mod
from . import todo, vault_sync
from .vault import Vault, VaultError


class WriteRequest(BaseModel):
    path: str
    content: str


class QuickAddRequest(BaseModel):
    text: str
    target: str = "week"  # or "backlog"


class MoveRequest(BaseModel):
    source: str
    line: int
    target: str
    heading: str | None = None


def create_app(vault: Vault | None = None, sync=None, static_dir: Path | None = None):
    if vault is None:
        cfg = config_mod.load()
        vault = Vault(cfg.vault_path)
        vault.ensure()
        sync = sync or vault_sync.make(cfg.sync, vault.root)
    sync = sync or vault_sync.make("local", vault.root)

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
    def list_files():
        return {
            "files": [n.to_dict() for n in vault.list_files()],
            "sync": sync.status().to_dict(),
        }

    @app.get("/api/file")
    def read_file(path: str):
        return {"path": path, "content": guard(vault.read_file, path)}

    @app.put("/api/file")
    def write_file(req: WriteRequest):
        guard(vault.write_file, req.path, req.content)
        return {"ok": True, "sync": sync.status().to_dict()}

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
