# Where this is

_Last updated: 2026-08-28 — end of Phase 2._

## Running it in 30 seconds

```bash
cd backend-python && uv run sage
```

Everything is installed. If the frontend changed, `cd frontend && npm run build` first.
For hot-reload: `npm run dev` in `frontend/`, then `SAGE_DEV=1 uv run sage`.

```bash
cd backend-python && uv run pytest   # 43 passed, 1 skipped
cd frontend && npm test              # 39 passed
```

The skip is a ripgrep-vs-Python search comparison; `rg` is not installed on this machine,
so `vault.search()` uses the pure-Python fallback. Not a problem at current scale — see
the search ladder in the README.

## Done — Phases 1 and 2

Editor, file tree, autosave, native window, and the core todo loop, all working:

- `⌘⇧T` quick-add (`↵` week, `⇧↵` backlog) · `⌘⏎` toggle · `⌘⇧↑` promote · `⌥↑/↓` nudge
  · `⌘⇧K` delete · `⌘⇧H` hide completed · `⌘S` force save
- Atomic writes, path-traversal guard, week/backlog seeding
- The three contracts are in place: `VaultBackend`, `VaultSync`, `ContextStrategy`
- `⌘K` palette (commands are data, so Phase 3 skills join the same list)
- Deterministic weekly rollover with `rolled:` counts and stale flagging
- Send-to-backlog / pull-from-backlog, preserving rolled counts
- `[[wiki-links]]` with `⌘`-click, dotted rendering for unresolved links
- Backlinks panel, built on `search()` — no index
- `⌘\` split pane, ⌥-click a file to open it there

Vault lives at `~/notes` (config: `~/.config/sage/config.toml`).

## Next — Phase 3 (the AI layer)

In rough order:

1. **Skill runner** — load `.sage/skills/*.md` (frontmatter: title, model, context
   strategy; body: the prompt) and append them to the palette's command list. The palette
   needs no changes; that was the point of making commands data.
2. **Selection transforms** — cleanup, expand, tighten. Highest frequency, unambiguous
   context, verifiable at a glance. Build these before generation.
3. **Diff review** — never replace text silently. Show the change, accept or reject.
4. **Provenance rendering** — the `<!-- sage:ai … -->` markers, and CodeMirror handling
   that does not let editing corrupt them.
5. **Weekly summary** — read the `- [x]` lines from a week file, write prose back under a
   `## Summary` heading in that same file so it archives with the week.
6. **Ask-with-context** — the one research feature worth building, because the vault is the
   context. Generic research belongs in a chat window.

The API key belongs in the Python backend, read from an env var or a config file — never
in the frontend bundle. Use the official `anthropic` package.

## Open questions

- **Does `## Now` earn its place?** Kept because a flat list cannot express the commitment
  line. Use it for a week; if you never look at it, delete the heading — nothing in the
  code depends on it.
- **Rollover cadence** — currently an explicit palette command. Should it offer itself when
  the week file is new and a previous week has leftovers?
- **Where the weekly summary lands** — planned as a `## Summary` section in the week file
  so it archives with the week. Confirm before building it.
- **Which context strategy each skill defaults to** — selection for transforms, whole note
  for expand, title-listing for ask-with-context.

## Watch out for

- **Editor save safety.** A bug once wrote one file's contents into another when switching
  files (React runs effect cleanup *after* re-rendering with the new props). Each editor
  instance now captures its own path. `src/components/__tests__/Editor.test.tsx` guards
  this and was verified to fail against the old implementation — keep those tests passing.
- **Headings are not a schema.** Capture creates whatever section it targets. Renaming or
  deleting one must never break anything; there is a test for it.
- **Rollover must never lose a task.** It is deterministic precisely so it can be trusted.
  `tests/test_todo_phase2.py` covers ordering, sections, rolled counts, idempotency, and
  leaving the archive untouched — keep those green.
- **The vault is not a git repo yet.** Git-backed sync is Phase 4. Until then `~/notes` has
  no version history — worth a manual backup if real notes accumulate.
