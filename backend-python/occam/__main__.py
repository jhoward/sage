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


def set_app_name(name: str = "Occam Notes") -> None:
    """Show the app's own name in the macOS menu bar instead of "python3".

    A Python process inherits the interpreter's name, so an unbundled app announces
    itself as python3. Overriding the bundle's display name fixes the menu bar without
    needing a real .app — which is what the eventual Tauri build will provide properly.
    Must run before AppKit is initialised, which importing webview does — hence the
    deferred import in main().
    """
    if sys.platform != "darwin":
        return
    try:
        from Foundation import NSBundle
    except ImportError:
        return

    bundle = NSBundle.mainBundle()
    if not bundle:
        return
    info = bundle.localizedInfoDictionary() or bundle.infoDictionary()
    if info is not None:
        info["CFBundleName"] = name
        info["CFBundleDisplayName"] = name


ICON = REPO_ROOT / "assets" / "icon.png"


def set_dock_icon(path: Path = ICON) -> None:
    """Set the Dock icon at runtime.

    An unbundled Python process shows a blank document icon. pywebview's `icon=` argument
    does not cover macOS, so this goes through AppKit directly. A real .app bundle would
    read assets/icon.icns from its Info.plist instead; this is the unbundled equivalent.

    Must run after the GUI loop is up, so it is passed to webview.start() as its callback.
    """
    if sys.platform != "darwin" or not path.exists():
        return
    try:
        from AppKit import NSApplication, NSImage
    except ImportError:
        return

    image = NSImage.alloc().initWithContentsOfFile_(str(path))
    if image:
        NSApplication.sharedApplication().setApplicationIconImage_(image)


def main() -> int:
    dev = os.environ.get("SAGE_DEV") == "1"

    # Rename before importing webview: the import brings up AppKit, which reads the
    # bundle name once. Imported at the top of the file, the rename would come too late.
    set_app_name()
    import webview

    cfg = config_mod.load()
    vault = Vault(cfg.vault_path)
    vault.ensure()
    sync = vault_sync.make(cfg.sync, vault.root)
    sync.startup()

    app = create_app(vault, sync, static_dir=None if dev else DIST_DIR, cfg=cfg)

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

    window = webview.create_window("Occam Notes", url, width=1200, height=800)
    # Handed to the app so it can put the open note in the title bar. A webview ignores
    # document.title on macOS, so the native window has to be told.
    app.state.window = window
    # Passed as the start callback rather than called beforehand: pywebview brings up
    # AppKit inside start(), and an icon set before that is discarded.
    webview.start(set_dock_icon)

    sync.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
