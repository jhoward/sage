# Where this is

_Last updated: 2026-08-28 — AI connected and working end to end._

## Running it in 30 seconds

```bash
cd backend-python && uv run sage
```

Everything is installed. If the frontend changed, `cd frontend && npm run build` first.
For hot-reload: `npm run dev` in `frontend/`, then `SAGE_DEV=1 uv run sage`.

```bash
cd backend-python && uv run pytest   # 93 passed, 1 skipped
cd frontend && npm test              # 79 passed
```

The skip is a ripgrep-vs-Python search comparison; `rg` is not installed on this machine,
so `vault.search()` uses the pure-Python fallback. Not a problem at current scale — see
the search ladder in the README.

## Done — Phases 1 through 3.5, plus AI actually running

Editor, file tree, autosave, native window, and the core todo loop, all working:

- `⌘⇧T` quick-add (`↵` week, `⇧↵` backlog) · `⌘⏎` toggle · `⌘⇧↑` promote · `⌥↑/↓` nudge
  · `⌘⇧K` delete line · `⌘⇧H` hide completed · `⌘S` force save (promote is `⌥⇧↑`)
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
- Delete a note (`⌘K`), which asks you to type its name — there is no undo yet
- All global shortcuts in one table; Ctrl is never treated as Cmd on macOS, so the
  readline bindings (`⌃A`, `⌃E`, `⌃K`, `⌃N`…) still work

**The AI works.** Config lives at `~/.config/sage/config.toml` with the key and, because
this is an identity-linked key, `anthropic_workspace_id` (workspace `sage`,
`wrkspc_01JRamYCGCoa4QDfLgeKnAkC`). Verified against the real API: Clean up and Weekly
summary both produce good output. Expand and Ask have generated but their output has not
been judged yet.

Every test injects a fake client, so the suite still needs no key and costs nothing.

### Setup gotchas already solved

Worth knowing, because each one cost time:

- A Claude Pro/Max subscription does **not** include API access — the API is billed
  separately with its own credits.
- An identity-linked (personal) key needs `anthropic_workspace_id`. The org had zero
  workspaces, so the console offered nothing to select; one had to be created first.
- A personal key carries full account permissions. A workspace-scoped key would be
  narrower and needs no workspace ID at all — worth switching to at some point.

Vault lives at `~/notes` (config: `~/.config/sage/config.toml`).

## Known rough edges

The user's words: "there are a ton of other things." Not yet enumerated — ask before
starting Phase 4, since polish on daily-use friction may be worth more than sync.

Already known:

- Expand and Ask prompts are unjudged. They are files in `.sage/skills/`; edit and re-run.
- The Weekly summary ends with a caveat about vague tasks. Honest, but you would delete it
  before pasting into a standup — consider whether that skill should suppress it.
- The bold macOS app-menu title needs a real `.app` bundle to change; menu *items* say Sage.

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
- **Test the wiring, not just the parts.** Accept silently did nothing for a while because
  `ref={editor}` was missing in App, while every Editor test passed — they supplied the ref
  themselves. `src/components/__tests__/wiring.test.tsx` guards the composition now.
- **Do not restore source files from ad-hoc backups.** Twice a `cp` from /tmp silently
  reverted props added after the backup was taken. Use git.
- **Rollover must never lose a task.** It is deterministic precisely so it can be trusted.
  `tests/test_todo_phase2.py` covers ordering, sections, rolled counts, idempotency, and
  leaving the archive untouched — keep those green.
- **The vault is not a git repo yet.** Git-backed sync is Phase 4. Until then `~/notes` has
  no version history — worth a manual backup if real notes accumulate.
