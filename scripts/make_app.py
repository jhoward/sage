"""Build Occam Notes.app — a minimal macOS bundle around the dev install.

The unbundled app has two cosmetic problems that cannot be fully fixed from inside a
Python process: the Dock shows a blank document icon, and the menu bar says "python". Both
are properties the system reads from a bundle's Info.plist *before* any code runs, so the
only real fix is to be a bundle.

This is not a distributable app — it launches the working copy in place, so the repo has to
stay where it is and `uv sync` has to have been run. A shippable build is the Tauri phase.

    uv run python scripts/make_app.py

Writes Sage.app next to the repo. Drag it to /Applications or the Dock.
"""

from __future__ import annotations

import plistlib
import shutil
import stat
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
APP = REPO / "Occam Notes.app"
ICON = REPO / "assets" / "icon.icns"

LAUNCHER = """#!/bin/sh
# Launch the working copy in place. Not relocatable — see scripts/make_app.py.
cd "{backend}" || exit 1
exec "{uv}" run notes
"""


def main() -> int:
    if not ICON.exists():
        print("assets/icon.icns is missing — run scripts/make_icon.py first")
        return 1

    uv = shutil.which("uv")
    if not uv:
        print("uv is not on PATH")
        return 1

    if APP.exists():
        shutil.rmtree(APP)

    macos = APP / "Contents" / "MacOS"
    resources = APP / "Contents" / "Resources"
    macos.mkdir(parents=True)
    resources.mkdir(parents=True)

    shutil.copy(ICON, resources / "icon.icns")

    launcher = macos / "Notes"
    launcher.write_text(LAUNCHER.format(backend=REPO / "backend-python", uv=uv))
    launcher.chmod(launcher.stat().st_mode | stat.S_IEXEC)

    (APP / "Contents" / "Info.plist").write_bytes(
        plistlib.dumps(
            {
                "CFBundleName": "Occam Notes",
                "CFBundleDisplayName": "Occam Notes",
                "CFBundleIdentifier": "com.jimhoward.occam",
                "CFBundleExecutable": "Notes",
                "CFBundleIconFile": "icon",
                "CFBundlePackageType": "APPL",
                "CFBundleShortVersionString": "0.1.0",
                "CFBundleVersion": "0.1.0",
                "LSMinimumSystemVersion": "11.0",
                # A GUI app, so it gets a Dock tile and a menu bar rather than running
                # as a background process.
                "LSUIElement": False,
                "NSHighResolutionCapable": True,
            }
        )
    )

    # Nudge Launch Services so the new icon is picked up rather than a cached blank sheet.
    subprocess.run(["touch", str(APP)], check=False)

    print(f"built {APP}")
    print("Drag it to /Applications or the Dock. It launches this working copy in place.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
