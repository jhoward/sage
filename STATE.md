# Where this is

_Last updated: 2026-09-20 — git sync is live; the real vault is `~/occam`, backed up to a private GitHub repo._

## Running it in 30 seconds

```bash
cd backend-python && uv run notes
```

Everything is installed. If the frontend changed, `cd frontend && npm run build` first.
For hot-reload: `npm run dev` in `frontend/`, then `SAGE_DEV=1 uv run notes`.

```bash
cd backend-python && uv run pytest   # 278 passed, 1 skipped
cd frontend && npm test              # 254 passed
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
- Skills as vault files (`.occam/skills/*.md`), joining the palette as ordinary commands
- Streaming generation into a review panel — `⌘↵` accept, `esc` discard, nothing silent
- Four context strategies: selection, note, note-and-links, week-done
- `⌘O` file switcher (recently opened first) split out from `⌘K`, `⌘⇧F` vault search
- `⌘N` new note; `⌘`-click an unresolved `[[link]]` to create it
- Rename with inbound link rewriting
- Settings = revealing `.occam/` in the tree; no settings panel
- Live preview over the markdown syntax tree: formatting renders, and its markers hide
  unless the cursor is inside the span — so there is still no mode to toggle
- Delete a note (`⌘K`), which asks you to type its name — there is no undo yet
- All global shortcuts in one table; Ctrl is never treated as Cmd on macOS, so the
  readline bindings (`⌃A`, `⌃E`, `⌃K`, `⌃N`…) still work

**The AI works.** Config lives at `~/.config/occam/config.toml` with the key and, because
this is an identity-linked key, `anthropic_workspace_id` (workspace `sage`,
the ID is in the config file, not here — this repo is public). Verified against the real API: Clean up and Weekly
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

The real vault is `~/occam` (config: `~/.config/occam/config.toml`), pushed to the private
repo `jhoward/notes`. `~/notes` is the old generated test data, left intact as a demo vault —
point `vault_path` at it to get 59 interlinked notes to test against.

## Done — the standard-UI pass (2026-08-29)

Table stakes that were missing, all keyboard- and mouse-reachable:

- Back / forward `⌘[` `⌘]`, sidebar toggle `⌘⇧B`, resizable sidebar (drag, double-click
  resets), per-note scroll memory, live window title
- `⌘B` / `⌘I`, `⇥` / `⇧⇥` to indent and outdent list items
- Right-click menu and double-click-to-rename in the tree

Live preview was rebuilt on the markdown syntax tree. Formatting renders and its markers
hide unless the cursor is inside the span — the Obsidian Live Preview model, and still not
a mode. **Coverage is narrower than Obsidian's**: bold, italic, inline code, strikethrough,
headings and blockquotes render; links, images, tables, code blocks and horizontal rules
keep their syntax. Links are the obvious next one and the same mechanism.

## Done — todo discoverability (2026-09-19)

The trigger: after real use, `⌘⏎` had been forgotten, numbered lists were typed instead,
and there was no way to check one off. The command existed; nothing showed it.

- **One key table.** The editor's commands (`⌘⏎`, `⌥⇧↑`, `⌘⇧H`, bold, italic…) moved out
  of a private CodeMirror keymap into `BINDINGS`. They now appear in `⌘K`, in the key
  sheet, and in `keybindings.toml`. `lib/editorKeys.ts` matches them at event time, so an
  override that loads after the editor is built still applies.
- **`⌘/` key sheet** in the split pane, written to `.occam/keys.md` from the table on every
  open. Replaces the hand-written sidebar list, which had gone stale. A test fails if a
  binding is missing from the sheet.
- **Drawn, clickable checkboxes**; raw markdown returns when the cursor is on the box.
- **Numbered tasks** on both sides: `1. [ ]` parses in the editor and in `todo.py`. Moving
  or rolling one re-renders it as `- [ ]`, so a number never lands in another list.
- **`⌘⇧⏎` un-tasks**, keeping the bullet or number.
- **List-aware `⇥` / `⇧⇥`**: nests to the parent's text column (3 under `4. `, not 2),
  takes children along, renumbers both levels. With nothing above to nest under it falls
  back to a plain indent.
- **Numbers stay in order after `⌘⇧K`, `⌥↑/↓` and `⌥⇧↑`** too, in the same transaction, so
  it is one undo. The list keeps the start it had *before* the edit — deleting item 1 must
  not leave it starting at 2. `⌘⇧K` is our own `deleteLines`: CodeMirror's steers the
  cursor by pixel geometry and cannot run against a stand-in dispatch. Deleting a line by
  hand (select, backspace) deliberately does not renumber.
- **A selection ending at column 0 excludes that line**, for every line-wise todo command —
  the rule `⌘B` already had. It also stopped the untouched line below from deciding
  whether a batch `⌘⏎` checks or unchecks.
- The drawn tick is CSS, never text: a box with text in it aligns by the text baseline, an
  empty one by its bottom edge, which made done boxes sit lower than open ones.
- Global shortcuts now listen in the capture phase and stop propagation. Before, `⌘]` went
  forward *and* indented the line in the note being left, because CodeMirror saw it too.

Not checked by eye: the checkbox styling in `index.css`. Behaviour is covered by
`lib/__tests__/todoView.test.ts`; how it looks beside real text is not.

## Done — sidebar finish and a dark palette (2026-09-19)

Apple Notes' finish, not its three-column structure (`⌘O` already does what the note
list is for). The editor font stays monospace — asked and answered.

- Sidebar rows are `.side-row`: 26px, inset rounded selection, a hover state, one rotating
  chevron. The OCCAM header bar is gone; sync status moved to the footer.
- `lib/highlight.ts` replaces CodeMirror's default highlight style, whose colours assume a
  white page. Every tag points at a `--ink-*` token, so it follows the system appearance.
- The caret and selection are now coloured. CodeMirror draws its own, and the defaults
  were a black caret and a pale lavender selection — both invisible in dark mode.
- `--ink-on-accent` for text on accent fills: the dark accent is light, so white washed out.
- Fixed: right-click, rename and ⌥-click did nothing on anything inside a folder, because
  `FileTree` passed those handlers to top-level rows only.

Seen in both appearances now and judged good; a few dark-mode nits of taste are still to
come.

- **Frontmatter renders as a header** (`lib/frontmatter.ts`): `WEEK 38 · 2026` over the
  dates, "Backlog", a meeting's kind and date, a skill's title and settings. Click or arrow
  in and the raw lines return. The week number is derived — ISO week of the Monday after
  the `week:` date, the inverse of the old `2026-W35.md` migration — and the file still
  stores the date. It is a StateField because block decorations cannot come from a plugin.
- A new editor puts the cursor at the start of the note body, not offset 0: a cursor in
  the frontmatter is what reveals it. An external reload now keeps the cursor in place.

## Done — git sync, Phase 4 item 1 (2026-09-20)

`vault_sync/git.py`, behind the `VaultSync` protocol from Phase 1. **Live since
2026-09-20**: verified end to end against GitHub — the startup commit, an automatic commit
after the quiet period, and a clean quit, all pushed without intervention.

- Commits when the vault has been quiet 30s, or dirty 5 min; on startup (work done while
  closed) and on quit. Messages are derived from the change list — no model.
- `run_ticker` drives `tick()` every 15s. The protocol always had `tick`; nothing called it.
- Conflicts are detected with `git merge-tree` *before* rebasing. The first version
  started the rebase and aborted it, which rewrote the open note on disk on every retry.
- Failed exchanges wait 60s before retrying, and only a successful one clears "offline".
- The frontend polls `/api/sync` every 15s; it used to learn the status only when the
  file tree refreshed.
- Tests run real git against a bare repository on disk. Nothing is mocked.
- **The indicator is four colours** (2026-09-21): grey off, green nothing waiting, yellow
  will pass by itself (`pending` edits, `syncing`, `offline`), red needs you (`error`,
  `conflict`). Grey used to mean "fine", which made a healthy backup look switched off, and
  the word beside it was "git". `unreachable()` sorts a failed exchange by git's message:
  no network is yellow, a refused key or missing repository is red. Jim proposed red for
  any failed connection; yellow-for-offline was my counter, to keep red rare — revisit if
  he finds a dead network going unnoticed.

Known gaps, deliberately left:
- **No history or restore UI.** The payoff feature — "this note last Tuesday" in the split
  pane — is the natural next step. Until then, `git log -p` in the vault.
- **A pull does not reload the open note.** Commits arriving from another machine change
  files under the editor, and the next autosave would overwrite them (history keeps both).
  Irrelevant on one machine; must be fixed before using two.
- Commits are authored as "Occam Notes" because this machine has no global git identity.
  `git config --global user.name/user.email` changes that.

**Watch out:** `Config` is constructed positionally in tests. A field added mid-order
shifts every later argument — `sync_remote` went in after `sync` at first, and the API key
landed in it, one step from being passed to git as a remote URL. New fields go last.

## Done — settings (2026-09-21)

Decided: **one organized, scrolling settings screen for values; files for anything with a
body.** The worry was that two kinds of settings leaves people guessing which kind they
want. This rewords a line of the "no" list, on purpose — see the README.

- `⌘,` opens it, and so do a gear in the sidebar footer and the backup indicator. The
  first build had only the shortcut and the palette, so it could not be found — the same
  mistake this whole stretch of work began with. Sections: Backup, AI, You, Vault, AI
  skills, Keyboard.
- Skills are listed by name with what each reads and where its result goes, in words made
  from its frontmatter, and an Edit button that opens the file. This replaced a "Show
  skills in the sidebar" button that revealed a folder behind a closing dialog.
- **Unconfirmed: whether `⌘,` reaches the page inside the app.** pywebview does not take
  it, but it could not be pressed from here. If it does not work, add a native
  "Settings…" item to the app menu.
- Worth a look: "Expand" has `context: note` with `mode: replace`, so with no selection it
  replaces the whole note, while its prompt talks about the selected text.
- Everything applies on Save except the vault folder. `SyncHolder` makes the sync backend
  swappable, so turning backup on takes effect at once; the key, workspace and names were
  already read from the live config on every request.
- The API key is write-only. `GET /api/settings` reports `apiKeySet` and never the key;
  there is a test that the key's text is absent from the response.
- A remote is validated before it reaches git: one starting with `-` would be read as an
  option (`--upload-pack=…` runs a command). **Check** uses `git ls-remote` for reach and
  an anonymous request to GitHub for visibility — verified live: `notes` private, `sage`
  public.
- `config.update` edits values in place, so comments survive, and leaves the file mode 600.
- With settings open the global key handler stands down; it runs in the capture phase and
  `⌘⌫` in a text field would otherwise reach "delete this note" first.
- Along the way: non-markdown files open as plain text (`keybindings.toml` had been a wall
  of H1s), a saved keybindings file applies at once, and an unparseable one says so.

Not seen by eye. Changing the vault folder does not move notes; with git sync on, pointing
at a folder with a different history and the same remote will not reconcile by itself.

## Known rough edges

The user's words: "there are a ton of other things." Not yet enumerated — ask before
starting Phase 4, since polish on daily-use friction may be worth more than sync.

Already known:

- Expand and Ask prompts are unjudged. They are files in `.occam/skills/`; edit and re-run.
- The Weekly summary ends with a caveat about vague tasks. Honest, but you would delete it
  before pasting into a standup — consider whether that skill should suppress it.
- Renamed from Sage to Occam Notes. `.sage/` in a vault and `~/.config/sage/` are migrated on startup; both migrations are idempotent.

## Next — Phase 4

1. ~~Git-backed sync~~ — built, see above; needs switching on and a history UI. Was: (`sage/vault_sync/git.py`) — `pull --rebase` / commit / push on a
   timer, behind the `VaultSync` protocol that has been in place since Phase 1. This is
   the biggest outstanding gap: the vault still has no version history, and it doubles as
   the undo layer for AI edits.
2. **Auto-link suggestions** — surface `[[notes]]` that already exist as you type. Where
   the model genuinely beats you, since remembering what is in the vault is the hard part.
3. ~~Keybinding overrides~~ — done; `<vault>/.occam/keybindings.toml` is seeded with every
   command, unknown names ignored, collisions reported.

Then Phase 5: external resolvers (Jira/Docs), per-project backlogs, and semantic search
only if the escalation ladder in the README actually demands it.

### Worth doing soon, out of phase order

- **Try the skills on real notes.** The four defaults are a first guess at prompts. They
  are files — edit them until the output is what you want, which is the whole point.
- **A "tighten" skill.** Named in the design as high-frequency, never written.
- **Render links in live preview.** `[text](url)` shows its full URL mid-sentence, which is
  the same readability problem the `**` were. Images and tables are widget work and a
  bigger step; links are not.
- ~~Drag-and-drop in the file tree~~ — done 2026-09-21. "Reachable two ways" turned out not
  to be the point: dragging is the way people *try*. Rules live in `lib/treeDrag.ts`: only
  notes drag (folders into folders is how a tree gets deep); `todo/` and `.occam/` are
  closed both ways, because a week file dragged out would not error, rollover would just
  never see it again; a drop on a note means that note's folder; a closed folder opens
  under a resting drag. It calls the same `rename` as the Move prompt, so links follow.
  **Not yet confirmed in the real webview** — the tests drive jsdom, and pywebview's
  WKWebView is where HTML5 drag-and-drop would misbehave if it is going to.

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
- **Live preview hides a marker only when its construct is rendered.** A blanket list of
  marker node names hid the ``` fences of code blocks, because FencedCode uses the same
  `CodeMark` node as inline code and nothing styled the block. Keep the rule: no rendering,
  no hiding. It is narrower than Obsidian's — links, images, tables and code blocks show
  their syntax — and that is a coverage gap, not a different design.
- **Emphasis cannot cross a block boundary.** A single `**…**` wrapped around several list
  items parses as a paragraph plus an unrelated list, and shows literal asterisks in every
  renderer. `⌘B` on a multi-line selection therefore wraps each line inside its list marker.
  If bold ever looks broken again, check whether the markdown is valid before blaming the
  renderer — that mistake cost a rewrite of the wrong component.
- **No provenance markers.** They were tried and removed: the pairing broke on any edit
  near a boundary, and a marker outlived the text it described, so it made false claims
  about paragraphs you had since rewritten. Git is the right place for this.
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
- **The notes repo must stay private.** `jhoward/notes` was created private and checked
  before the first push. Adding a collaborator shares every note and the whole history.
- `~/.config/occam/config.toml` holds the API key and is now mode 600, as is the `.bak`
  beside it. It was world-readable before.
