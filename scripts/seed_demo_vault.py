"""Populate a vault with sample notes, for exercising features that need real content.

Related-notes surfacing, ask-with-context, and backlinks are all worthless against three
test notes and only show their shape against a few dozen interlinked ones. This writes a
plausible AI-governance vault: ~44 notes, roughly three out-links each, a couple of
deliberately dangling links, and a mix of polished references and rough meeting notes —
because a real vault is mostly the latter.

    uv run python scripts/seed_demo_vault.py

Writes into the configured vault under notes/. Existing files with the same names are
overwritten; nothing else is touched.
"""

import importlib.util, sys
from pathlib import Path

sys.path.insert(0, "/Users/jimhoward/code/sage/backend-python")
from sage.config import load
from sage.vault import Vault

notes = {}
for part in ["part1", "part2", "part3", "part4", "part5", "part6"]:
    spec = importlib.util.spec_from_file_location(part, f"{part}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    notes.update(mod.NOTES)

v = Vault(load().vault_path)
for name, body in notes.items():
    v.write_file(f"notes/{name}", body)

print(f"wrote {len(notes)} notes")
