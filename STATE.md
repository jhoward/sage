# Where this is

_Last updated: 2026-08-28 — end of Phase 1._

## Running it in 30 seconds

```bash
cd backend-python && uv run sage
```

Everything is installed. If the frontend changed, `cd frontend && npm run build` first.
For hot-reload: `npm run dev` in `frontend/`, then `SAGE_DEV=1 uv run sage`.

```bash
cd backend-python && uv run pytest   # 27 passed, 1 skipped
cd frontend && npm test              # 14 passed
```

The skip is a ripgrep-vs-Python search comparison; `rg` is not installed on this machine,
so `vault.search()` uses the pure-Python fallback. Not a problem at current scale — see
the search ladder in the README.

## Done — Phase 1

Editor, file tree, autosave, native window, and the core todo loop, all working:

- `⌘⇧T` quick-add (`↵` week, `⇧↵` backlog) · `⌘⏎` toggle · `⌘⇧↑` promote · `⌥↑/↓` nudge
  · `⌘⇧K` delete · `⌘⇧H` hide completed · `⌘S` force save
- Atomic writes, path-traversal guard, week/backlog seeding
- The three contracts are in place: `VaultBackend`, `VaultSync`, `ContextStrategy`

Vault lives at `~/notes` (config: `~/.config/sage/config.toml`).

## Next — Phase 2

In rough order:

1. **`⌘K` command palette** — the single invocation surface. Built-in commands now; skills
   join the same list in Phase 3.
2. **Weekly rollover** — deterministic, no model: create next week's file, copy unfinished
   items preserving order and section, increment `rolled:` counts, leave the old file as
   the archive. Flag anything rolled 5+ times for do/delegate/drop.
3. **Backlog pull/send** — move a task between the week and the backlog from the palette.
   `todo.backlog_paths()` already resolves a glob, so this works unchanged when backlogs
   split per project.
4. **Wiki-links and backlinks** — parse `[[links]]` in the frontend (not the backend; that
   is what keeps the Rust port cheap).
5. **Split view** — week and backlog side by side for planning. Generic, so it serves notes
   too.

## Open questions

- **Does `## Now` earn its place?** Kept because a flat list cannot express the commitment
  line. Use it for a week; if you never look at it, delete the heading — nothing in the
  code depends on it.
- **Rollover cadence** — explicit command, or offered automatically when the week's file
  does not exist yet? Leaning explicit.
- **Where the weekly summary lands** — planned as a `## Summary` section in the week file
  so it archives with the week. Confirm when Phase 3 starts.

## Watch out for

- **Editor save safety.** A bug once wrote one file's contents into another when switching
  files (React runs effect cleanup *after* re-rendering with the new props). Each editor
  instance now captures its own path. `src/components/__tests__/Editor.test.tsx` guards
  this and was verified to fail against the old implementation — keep those tests passing.
- **Headings are not a schema.** Capture creates whatever section it targets. Renaming or
  deleting one must never break anything; there is a test for it.
- **The vault is not a git repo yet.** Git-backed sync is Phase 4. Until then `~/notes` has
  no version history — worth a manual backup if real notes accumulate.
