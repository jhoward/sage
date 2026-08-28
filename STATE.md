# Where this is

_Last updated: 2026-08-28 — end of Phase 3.5 (editor and todo polish)._

## Running it in 30 seconds

```bash
cd backend-python && uv run sage
```

Everything is installed. If the frontend changed, `cd frontend && npm run build` first.
For hot-reload: `npm run dev` in `frontend/`, then `SAGE_DEV=1 uv run sage`.

```bash
cd backend-python && uv run pytest   # 74 passed, 1 skipped
cd frontend && npm test              # 58 passed
```

The skip is a ripgrep-vs-Python search comparison; `rg` is not installed on this machine,
so `vault.search()` uses the pure-Python fallback. Not a problem at current scale — see
the search ladder in the README.

## Done — Phases 1 through 3.5

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
- Skills as vault files (`.sage/skills/*.md`), joining the palette as ordinary commands
- Streaming generation into a review panel — `⌘↵` accept, `esc` discard, nothing silent
- Provenance markers on accepted text, rendered tinted and still editable
- Four context strategies: selection, note, note-and-links, week-done
- `⌘O` file switcher (recently opened first) split out from `⌘K`, `⌘⇧F` vault search
- `⌘N` new note; `⌘`-click an unresolved `[[link]]` to create it
- Rename with inbound link rewriting
- Settings = revealing `.sage/` in the tree; no settings panel
- Live-preview styling (persistent, nothing hidden, so no mode to toggle)

**No API key is configured**, so skills appear in the palette but report a clear message
when run. Set `ANTHROPIC_API_KEY` or add `anthropic_api_key` to
`~/.config/sage/config.toml`. Every test uses a fake client, so the suite costs nothing.

Vault lives at `~/notes` (config: `~/.config/sage/config.toml`).

## Next — Phase 4

1. **Git-backed sync** (`sage/vault_sync/git.py`) — `pull --rebase` / commit / push on a
   timer, behind the `VaultSync` protocol that has been in place since Phase 1. This is
   the biggest outstanding gap: the vault still has no version history, and it doubles as
   the undo layer for AI edits.
2. **Auto-link suggestions** — surface `[[notes]]` that already exist as you type. Where
   the model genuinely beats you, since remembering what is in the vault is the hard part.
3. **Keybinding overrides** from `<vault>/.sage/keybindings.toml`.

Then Phase 5: external resolvers (Jira/Docs), per-project backlogs, and semantic search
only if the escalation ladder in the README actually demands it.

### Worth doing soon, out of phase order

- **Try the skills on real notes.** The four defaults are a first guess at prompts. They
  are files — edit them until the output is what you want, which is the whole point.
- **A "tighten" skill.** Named in the design as high-frequency, never written.

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
- **Nothing AI-generated reaches a file without review.** Generated text goes to a panel,
  and only accepting writes. Keep it that way — an app where a model can silently rewrite
  your thinking is one you cannot trust with your thinking.
- **The API key stays in the backend.** Never pass it to the frontend, never log it.
- **Rollover must never lose a task.** It is deterministic precisely so it can be trusted.
  `tests/test_todo_phase2.py` covers ordering, sections, rolled counts, idempotency, and
  leaving the archive untouched — keep those green.
- **The vault is not a git repo yet.** Git-backed sync is Phase 4. Until then `~/notes` has
  no version history — worth a manual backup if real notes accumulate.
