#!/bin/sh
# Set up Occam Notes from a fresh clone, or bring an existing one up to date.
#
#     git clone git@github.com:jhoward/sage.git && cd sage && ./install.sh
#
# Safe to run again after every `git pull`: each step is idempotent, and the app bundle
# is rebuilt in place. What it leaves behind is "Occam Notes" in ~/Applications, which
# Spotlight finds by name.
#
# This is only the order of operations. Building the bundle stays in scripts/make_app.py,
# which writes the Info.plist with a real plist library rather than by hand in shell —
# and Python is always here, because the app cannot run without uv anyway.

set -eu

REPO="$(cd "$(dirname "$0")" && pwd)"

say()  { printf '\n==> %s\n' "$1"; }
fail() { printf '\nerror: %s\n' "$1" >&2; exit 1; }

[ "$(uname)" = "Darwin" ] || fail "the app bundle is macOS only. On other systems: cd backend-python && uv run notes"

# Checked up front, so a missing tool is the first thing said rather than a failure
# three minutes into a build.
command -v uv  >/dev/null 2>&1 || fail "uv is not installed.   brew install uv    (https://docs.astral.sh/uv/)"
command -v npm >/dev/null 2>&1 || fail "node is not installed. brew install node"

say "Backend dependencies"
# With the dev extra. A bare `uv sync` does not merely skip extras, it *uninstalls* them,
# so re-running this after a pull would quietly take pytest away.
(cd "$REPO/backend-python" && uv sync --extra dev)

say "Frontend dependencies"
# `ci`, not `install`: it installs exactly what the lockfile says and never rewrites it,
# so setting up a machine cannot leave the repo with a diff.
(cd "$REPO/frontend" && npm ci --no-audit --no-fund)

say "Building the frontend"
(cd "$REPO/frontend" && npm run build)

say "Installing the app"
(cd "$REPO/backend-python" && uv run python ../scripts/make_app.py --install)

cat <<DONE

Done. Open it with Spotlight (⌘Space, "Occam"), or drag it to the Dock from ~/Applications.

The app runs this working copy in place, so keep the repo where it is:
    $REPO
If it moves, run ./install.sh again from the new location.

Already running? Quit and reopen it to pick up a new build.
DONE
