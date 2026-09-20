"""Build Occam Notes.app — a minimal macOS bundle around the dev install.

The unbundled app has two cosmetic problems that cannot be fully fixed from inside a
Python process: the Dock shows a blank document icon, and the menu bar says "python". Both
are properties the system reads from a bundle's Info.plist *before* any code runs, so the
only real fix is to be a bundle.

This is not a distributable app — it launches the working copy in place, so the repo has to
stay where it is and `uv sync` has to have been run. A shippable build is the Tauri phase.

    uv run python scripts/make_app.py            # build it next to the repo
    uv run python scripts/make_app.py --install  # and move it into ~/Applications

Install it and Spotlight finds it by name. Spotlight indexes a bundle wherever it lives,
but only ranks it as an *application* in /Applications or ~/Applications — sitting in a
code folder it is just another file, and never the top hit. Moving it there is safe because the
launcher holds absolute paths back to this working copy; a symlink would not do, since
Spotlight ignores symlinked apps. ~/Applications needs no admin password.
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
INSTALLED = Path.home() / "Applications" / APP.name
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

    if "--install" in sys.argv[1:]:
        INSTALLED.parent.mkdir(exist_ok=True)
        if INSTALLED.exists():
            shutil.rmtree(INSTALLED)
        # Moved, not copied: two bundles with one name is two identical Spotlight hits.
        shutil.move(str(APP), str(INSTALLED))
        subprocess.run(["touch", str(INSTALLED)], check=False)
        # Index it now rather than whenever Spotlight next gets round to it.
        subprocess.run(["mdimport", str(INSTALLED)], check=False)
        print(f"installed {INSTALLED} — Spotlight will find it as Occam Notes")
    else:
        print("Run again with --install to put it in ~/Applications, where Spotlight looks.")

    print("It launches this working copy in place, so the repo has to stay where it is.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
