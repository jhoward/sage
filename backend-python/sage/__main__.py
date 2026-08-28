"""Entry point: start the API on a free port, then open a native window.

In dev (SAGE_DEV=1) the window points at the Vite dev server so the frontend hot-reloads.
Otherwise it serves the built assets from frontend/dist through FastAPI itself.
"""

from __future__ import annotations

import os
import socket
import sys
import threading
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

import uvicorn
import webview

from . import config as config_mod
from . import vault_sync
from .app import create_app
from .vault import Vault

DEV_URL = "http://localhost:5173"
REPO_ROOT = Path(__file__).resolve().parents[2]
DIST_DIR = REPO_ROOT / "frontend" / "dist"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_for(url: str, timeout: float = 15.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            urlopen(url, timeout=1)
            return True
        except URLError:
            time.sleep(0.1)
        except OSError:
            time.sleep(0.1)
    return False


def main() -> int:
    dev = os.environ.get("SAGE_DEV") == "1"

    cfg = config_mod.load()
    vault = Vault(cfg.vault_path)
    vault.ensure()
    sync = vault_sync.make(cfg.sync, vault.root)
    sync.startup()

    app = create_app(vault, sync, static_dir=None if dev else DIST_DIR)

    port = free_port()
    server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    )
    threading.Thread(target=server.run, daemon=True).start()

    if not wait_for(f"http://127.0.0.1:{port}/api/sync"):
        print("backend failed to start", file=sys.stderr)
        return 1

    if dev:
        if not wait_for(DEV_URL, timeout=3):
            print(
                f"SAGE_DEV=1 but nothing is serving {DEV_URL}.\n"
                "Run `npm run dev` in frontend/ first.",
                file=sys.stderr,
            )
            return 1
        url = f"{DEV_URL}?api={port}"
    else:
        if not DIST_DIR.is_dir():
            print(
                f"No built frontend at {DIST_DIR}.\n"
                "Run `npm run build` in frontend/, or use SAGE_DEV=1.",
                file=sys.stderr,
            )
            return 1
        url = f"http://127.0.0.1:{port}/"

    webview.create_window("Sage", url, width=1200, height=800)
    webview.start()

    sync.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
