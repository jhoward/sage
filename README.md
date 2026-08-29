# Occam Notes

A local-first, AI-native notes and todo app.

Named for the razor, because the design argument here is mostly subtraction: a written
"no" list, features removed when they turned out to make false claims, and extension that
happens in your vault rather than in the codebase. Plain markdown files on disk, a fast editor,
and a weekly todo list that generates its own work summaries.

Phase 1 is built: editor, file tree, autosave, and the core todo interactions.

## Running it

```bash
brew install node                      # once

cd backend-python && uv sync --extra dev
cd ../frontend && npm install && npm run build

cd ../backend-python && uv run notes    # opens a native window
```

For frontend hot-reload, run `npm run dev` in `frontend/` and start the app with
`SAGE_DEV=1 uv run notes`.

### A real app icon and name

An unbundled Python process shows a blank document icon and calls itself "python", because
macOS reads both from a bundle's `Info.plist` before any code runs. Setting them from
inside the process only half works.

```bash
uv run python scripts/make_icon.py   # assets/icon.png + icon.icns, drawn in code
uv run python scripts/make_app.py    # Occam Notes.app
```

`Occam Notes.app` launches this working copy in place — it is not distributable and the repo has
to stay where it is. A shippable build is the Tauri phase. Drag it to the Dock.

```bash
cd backend-python && uv run pytest     # vault conformance suite
cd frontend && npm test                # todo commands + editor save safety
```

## Your vault

Notes live **outside this repo**, at `~/notes` by default, so the vault can be its own git
repo later without entangling it with the app. Change the location in
`~/.config/occam/config.toml`.

```
~/notes/
├── todo/
│   ├── 2026-08-23.md   this week, named for its Sunday — `## Now`, `## This week`
│   └── backlog.md       persistent; never rolls over
├── notes/
└── .sage/
    ├── keybindings.toml   (later — follows the vault across machines)
    └── skills/            (later — prompts as content)
```

## The todo system

The whole thing is one markdown file per week plus a few keybindings. There is no task
database, no index, and no separate todo view — the file is the only representation, so
nothing can drift out of sync with it.

| Action | Key |
|---|---|
| Command palette (commands and skills) | `⌘K` |
| Open a note (recently opened first) | `⌘O` |
| Search the vault | `⌘⇧F` |
| New note | `⌘N` |
| Rename a note, updating inbound links | `⌘K` → rename |
| Delete a note (confirm; undoable) | `⌘⌫` |
| Pull several tasks from the backlog | `⌘⇧P` |
| Settings (reveal `.occam/`) | `⌘K` → settings |
| Quick-add from anywhere → bottom of `## This week` | `⌘⇧T`, then `↵` |
| Quick-add to the backlog instead | `⌘⇧T`, then `⇧↵` |
| Start a meeting note (live notes) | `⌘⇧M` |
| Paste a recap — into this meeting, or a new one | `⌘⇧V` |
| Move a note to another folder | `⌘K` → move |
| Toggle done | `⌘⏎` |
| Promote to top of section | `⌥⇧↑` |
| Nudge up / down | `⌥↑` / `⌥↓` |
| Delete line | `⌘⇧K` |
| Hide completed (view only) | `⌘⇧H` |
| Force save | `⌘S` (autosaves after 500ms anyway) |
| Split pane (week + backlog) | `⌘\`, or ⌥-click a file |
| Follow a `[[link]]`, or create it if it does not exist | `⌘`-click |

Quick-add is global — it goes to this week's file regardless of which note you are
looking at, so capture never depends on where you happen to be.

Enter continues a list — another task after a task, another bullet after a bullet — and
Enter on an *empty* item removes it and leaves the list. That is why there is no "new task"
key: the obvious gesture already works. `⌘⏎` on a line that is not yet a task makes it one,
so the same key both creates and completes.

**Position is priority.** Line order is sort order — no priority field to maintain.
Sections are ordinary markdown headings, and nothing in the code enforces them: capture
creates whatever heading it targets, so rename or delete them freely.

The week has two sections because the only thing a flat ordered list cannot express is the
commitment line — `## Now` answers "what am I doing right now" without re-reading twenty
items. There is deliberately **no inbox**: an inbox earns its place only when there are
several destinations to sort into, which is not true until backlogs split per project.

**The active week should fit on one screen.** If it doesn't, you have over-committed. That
is why hide-completed exists: finished tasks stay in the file (they are the raw material
for weekly summaries) but leave the active view.

## Rollover and the palette

`⌘K` → "Roll unfinished work into this week" carries everything unfinished from the most
recent earlier week file into the current one, keeping each task in its section and
bumping a `<!-- rolled:N -->` counter. The source file is left untouched as that week's
archive, so what got done stays recorded for the weekly summary in Phase 3. Running it
twice skips rather than duplicates. Anything that has rolled five times or more is
surfaced for a do/delegate/drop decision rather than acted on.

None of this involves a model: it is instant, and it cannot silently drop a task.

The palette also moves tasks between the week and the backlog — "Send this task to the
backlog" acts on the cursor line, and every open backlog item appears as its own
`Pull: …` entry. A moved task keeps its rolled count, so parking something does not reset
the record of how long it has been avoided.

## Keybindings and the readline rule

**Ctrl is never an alias for Cmd on macOS.** The emacs/readline bindings — `⌃A`, `⌃E`,
`⌃K`, `⌃N`, `⌃P`, `⌃D` — work in every macOS text field, and treating `metaKey || ctrlKey`
as "the modifier" silently eats them: `⌃K` stops killing to end of line and opens a palette
instead. On macOS Mod means Cmd and nothing else; on Linux and Windows it means Ctrl.

That rule lives in `frontend/src/lib/keybindings.ts`, which is also where every global
shortcut is declared, and there are tests asserting that no `⌃`-anything matches a binding
on macOS. Phase 4 loads overrides from `<vault>/.occam/keybindings.toml` from that same table.

The second rule: **do not shadow a text-editing shortcut people rely on.** `⌥⇧↑` promotes a
task to the top of its section rather than `⌘⇧↑`, because on macOS that extends the
selection to the start of the document — worth more than a task shortcut. It also pairs
better: `⌥↑` nudges one line, `⌥⇧↑` goes all the way.

Two shortcuts do deliberately shadow something. `⌥↑`/`⌥↓` move a line instead of moving by
paragraph, which is what VS Code, Sublime, and JetBrains all do. And inside the palettes,
`⌃N`/`⌃P` move the selection — that *honours* the emacs convention rather than breaking it,
and in a one-line input there is no line to move to anyway.

## Folders are the only structure

There is no notebooks-or-sections concept, and there will not be: a folder already does
that job, and a second hierarchy on top of the filesystem is the thing the "no" list
exists to prevent.

Moving a note between folders is `⌘K` → "Move this note…", which is a rename underneath, so
inbound links follow it. There is no drag-and-drop: in a keyboard-first app a command that
also works from the palette beats a gesture that only works with a mouse, and dropping onto
the wrong folder in a nested tree is easier than it looks.

**You make a folder by naming one.** `⌘N` → `governance/vendor-risk` writes
`notes/governance/vendor-risk.md` and the folder comes into being by having a file in it;
so does renaming a note to a path, and so does ⌘-clicking `[[governance/vendor-risk]]`.
There is no "new folder" command because an empty folder is not something this app has any
use for. The other half of that bargain: when the last file leaves a folder, the folder
goes with it, so nothing accumulates that you cannot see or remove from inside the app.

`⌘K` → "Archive this note" moves a note to `archive/`, keeping the folder it came from so
provenance survives and two notes with the same name cannot collide. It is a move, not a
delete: search, links and the ask panel still reach it, and undo restores it. The point is
only to keep the folders you look at daily worth looking at — most obviously `todo/`, which
gains a week file every week.

Four are seeded because they earn it — `todo/`, `meetings/`, `notes/`, and `archive/` —
and the sidebar orders those by how often you want them rather than alphabetically, which
otherwise puts the archive at the top. Any folder you invent sorts in between.

Meetings sit at the top level rather than under `notes/` because they are *records* and
notes are *thinking*: dated, high-volume and archival versus slow and curated. Nested, a
year of meetings buries forty real notes.

## Two palettes, not one

`⌘K` lists commands and skills. `⌘O` lists notes, most recently opened first.

They are separate because a **file is an object and a command is an action** — mixing them
in one list is what makes a palette useless once a vault has hundreds of notes. Both are
the same component with different lists, so the split costs nothing.

## Settings is a folder

There is no settings panel. `⌘K` → Settings reveals the hidden `.occam/` directory in the
file tree, and you edit skills and config as ordinary files in the editor you already have.

```
<vault>/.occam/skills/*.md        prompts
<vault>/.occam/keybindings.toml   (Phase 4)
~/.config/occam/config.toml       machine-specific
```

## Live preview

Headings are sized, bold is bold, code is in a code face, blockquotes are ruled — but the
`**` and `#` markers stay visible, just dimmed.

This is not a mode and there is no toggle. Obsidian needs a separate Source view because
its Live Preview *conceals* syntax, so you sometimes need a way back to the real text.
Nothing is hidden here, so there is nothing to escape from.

## Wiki-links

`[[note-name]]` resolves by unique basename or full path, and `⌘`-click follows it. A link
to a note that does not exist yet renders dotted rather than hidden — while writing, that
is a normal state and seeing it is the point. An ambiguous name (the same basename in two
folders) deliberately does not resolve rather than guessing. `⌘`-clicking an unresolved
link **creates** that note — you write the link first and the page follows.

Renaming through the palette rewrites every `[[link]]` that pointed at the note, aliases
included. This is the one piece of wiki rot worth preventing early: without it a rename
quietly breaks every inbound link, and the damage is invisible and cumulative.

Backlinks ride on `search()` rather than an index: search for `[[name`, then re-parse each
hit to confirm the link really resolves. Nothing to rebuild, nothing to go stale, and the
backend contract stayed the same size.

## AI

Nothing runs without an API key, and the app is a perfectly good plain editor without one.
The key lives in the backend — `ANTHROPIC_API_KEY`, or `anthropic_api_key` in
`~/.config/occam/config.toml` — and never reaches the frontend bundle.

The config file is created with every setting present and documented, including the empty
ones, so you never have to guess what a key is called:

```toml
# ~/.config/occam/config.toml
vault_path = "/Users/you/notes"
sync = "local"
anthropic_api_key = ""       # ANTHROPIC_API_KEY in the environment wins over this
anthropic_workspace_id = ""  # only for identity-linked keys
```

If your key is **identity-linked** (it acts on behalf of a person rather than an
organisation) the API also needs a workspace ID, and returns a 400 without one. Find it in
the Anthropic Console under Settings → Workspaces; it looks like `wrkspc_…`. A standard
organisation key ignores this setting.

`⌘K` → "Set the Anthropic API key…" opens that file in your editor; restart Occam Notes after
saving, since config is read at startup. Until a key is set the palette shows skills marked
`needs API key` rather than letting you discover it by running one.

Prefer the file over the environment variable if you ever launch Occam Notes as an app — a shell
profile does not reach a GUI launch. And keep the key there rather than anywhere inside the
vault, because the vault becomes a git repo.

### Skills are files

A skill is a markdown file in `<vault>/.occam/skills/`. Four ship on first run — Clean up,
Expand, Ask, Weekly summary — and they are a starting point to edit, not a library.

```markdown
---
title: Tighten
context: selection      # selection | note | note-and-links | week-done
mode: replace           # replace | insert | append
effort: low             # low | medium | high | xhigh | max
---
Cut this text by a third without losing meaning. Return only the text.
```

`asks: true` makes a skill prompt for a question before it runs — that is what turns "Ask"
from a summariser into a question against your vault.

Once a skill file exists it is **yours**: the app never overwrites your prompt. It does add
frontmatter keys that a shipped skill gained later (an `asks: true` introduced after your
copy was created), because otherwise a new capability stays invisible forever. Existing
values are never changed, and skills you wrote yourself are never touched. `⌘K` → "Reset
skill to default" restores a shipped one wholesale.

They appear in `⌘K` alongside built-in commands, because a skill and a command are the same
kind of thing. `Edit skill: …` opens the prompt in the editor — it is a note like any other.
This is the anti-bloat mechanism in practice: the app does not grow, your skill folder does,
and a skill you stop using is a file you delete.

### Nothing is applied without review

Generated text streams into a review panel, never straight into the document. When it
finishes the panel takes focus, so `↵` accepts and `esc` discards. Accepting is the only
thing that touches a file.

There are deliberately **no provenance markers**. An earlier version wrapped generated text
in `<!-- sage:ai … -->` comments, and it was removed for two reasons. The pairing is
positional state in a plain text file, so any edit landing near a boundary stacked or
orphaned the markers. More importantly a marker outlives the text it describes: expand a
paragraph, rewrite it in your own words over the following week, and the marker still
claims a model wrote it. Stale provenance is worse than none, because you would act on it.

Git answers the same question properly — a commit shows exactly what the model wrote and
what you changed afterwards — and it does not rot.

## Meetings to follow-ups

The loop this app is for.

`⌘⇧M` opens an empty meeting note to take live notes in while the meeting happens. When the
recap arrives afterwards, `⌘⇧V` **appends it to that note** rather than starting a second
one about the same meeting — so extraction reads your notes *and* the recap, which beats
either alone: your notes record what you actually agreed to, the recap confirms and fills
it in.

If you are not in a meeting note, `⌘⇧V` takes a recap off the clipboard, writes it to
`meetings/<date>-<short-title>.md` with a title taken from the recap's own name — or written for it when there isn't one — and
immediately asks
for the follow-ups **you** committed to — not everyone else's actions. Each proposed task
links back to the meeting, so the reason it exists stays visible, and they land in this
week rather than the backlog because a commitment made in a meeting is usually live.

Set your name so it knows which commitments are yours:

```toml
me = ["Jim", "Jim Howard"]
```

This is deliberately **not** a Teams or Loop integration. Reading meeting content out of
either means the Graph API, an Azure AD app registration, and tenant admin consent — and a
personal tool ingesting corporate meeting transcripts is exactly the shadow-AI problem its
owner would flag at work. The clipboard needs no auth and is a decision you are already
allowed to make.

If you later want it automatic, the achievable path is a Power Automate flow writing
recaps into a synced folder that the app watches — auth stays inside Microsoft's own
tooling. Worth trying the paste for a fortnight first; it is usually not the annoying part.

## Ask the vault

`⌘J` opens a panel that can read every note. The questions worth asking are vault-wide —
"what have I said about override rates?" spans notes written weeks apart, and no general
chat can answer it. Answers cite the notes they used, as links you can click, which is what
makes the thing checkable rather than an oracle.

Retrieval is agentic: the model gets `search_notes` and `read_note` and opens what it
needs, with every note path in its system prompt so it rarely has to guess.

**Reads and writes differ by construction, not discipline.** Read tools have
implementations; write tools do not. A write call can only become a *proposal*, returned
for review — nothing in the ask path can touch a file. Applying is a separate step you
trigger.

Proposals are reviewed as a batch rather than one at a time, because a set of note edits is
usually one thought spread across files and approving the first without seeing the fourth
is how two of them end up contradicting each other. Additive changes are pre-selected;
replacements start unticked and expanded, since a replacement loses the original.
`⌘K` → "Undo last change" restores every file in the last applied batch — and a deleted
note, which shares the same slot. The answer to an irreversible action is to make it
reversible, not to make it tedious.

### Synthesis becomes notes

The most valuable thing a vault-wide answer produces is often an idea that isn't in any
single note — the connection across eight of them. That is also the hardest kind of note to
write by hand, because it needs all eight in your head at once.

So the model can propose a **new note**, and the rule is that it must link back to its
sources. A synthesis note that doesn't join the graph is one you will never find again.

**"Capture this…"** on any answer asks it to decide *where* the material belongs rather
than assuming a new note: appended to an existing note if it extends one, a new note only
if it is genuinely its own topic, named for what it says. Asked to capture something the
vault already covered, the right answer is "no change needed, it is already in
`notes/bias-testing.md`" — and that is what it gives.

### Context is the point

Each skill declares what goes in the context window: just the selection, the whole note, the
note plus every note it links to, or a week's completed tasks. That is why
"ask, with this note as context" is worth having and generic research is not — a chat window
cannot see your vault, and this can.

## Design principles

1. **The file is the source of truth.** No database of record. The vault survives the app.
2. **Every AI mutation is reviewable and revertible.** Diff before accept; a git commit per
   AI edit.
3. **Structure is derived but written back in standard markdown** — `- [ ]`, YAML
   frontmatter, never custom syntax. The vault degrades gracefully into Obsidian or `grep`.
4. **Prompts are content, not code.** Skills are markdown files in the vault.
5. **One invocation surface.** `⌘K` takes intent; a skill and a built-in command are the
   same kind of thing.
6. **Context strategy is explicit and swappable.** Every AI feature reduces to what went in
   the context window.
7. **Latency budget.** Local operations are instant; AI is async and never blocks a keystroke.
8. **Degrades to a good plain editor** with no network and no API key.

### The anti-bloat mechanism

OneNote and Evernote bloated because features are code, and code only accumulates. Here,
most "features" are markdown files in the vault. A skill you don't use is a file you delete.
The app doesn't grow — your skill folder does, and you prune it.

### The "no" list

Permanent, not "later":

- No notebooks/sections/pages hierarchy — files in folders
- No rich text, embedded objects, or drawing canvas — everything is markdown
- No modes (edit vs. view vs. present)
- No plugin API — skills are the extension point, and they are just prompts
- No sharing, commenting, or multiplayer
- No mobile app
- No feature requiring a settings panel longer than one screen

## Architecture

Three contracts carry the flexibility. Components never import a transport, sync never
touches the vault API, and AI features never build context strings inline.

| Contract | Where | Now | Later |
|---|---|---|---|
| `VaultBackend` | `frontend/src/backend/types.ts` | `http.ts` → Python | `tauri.ts` → Rust |
| `VaultSync` | `backend-python/sage/vault_sync/` | `LocalSync` (no-op) | `git.py`, `drive.py` |
| `ContextStrategy` | `backend-python/sage/context.py` | `SelectionOnly`, `CurrentNote` | title-listing retrieval |

The backend is deliberately dumb — list, read, write, search. Wiki-link parsing, markdown
rendering, and the backlink index belong in the shared frontend. That is what keeps a future
Rust port to about a day of work, and it is why the pytest suite in `backend-python/tests/`
matters: whatever implements the contract must pass those same cases.

### Why Python now

Performance was never the deciding factor — the backend walks a folder, reads text files,
and greps. Rust's real value is packaging a ~10MB double-clickable `.app`, which matters
eventually, not yet. The frontend is ~80% of the work and is identical either way.

## Roadmap

| Phase | Contents |
|---|---|
| **1** ✅ | Editor, file tree, autosave, three contracts, atomic writes, core todo interactions |
| **2** ✅ | `⌘K` palette, deterministic weekly rollover, backlog pull/send, wiki-links, backlinks, split view |
| **3** ✅ | Skill runner, selection transforms, ask-with-context, weekly summary, diff review |
| 4 | Git-backed sync, auto-link suggestions, keybinding overrides |
| 5 | External resolvers (Jira/Docs), per-project backlogs, semantic search only if needed |

### On search

Three operations get conflated, and separating them removes the need for a vector store:

- **Literal search** — ripgrep (or a pure-Python fallback) over a few thousand files is
  tens of milliseconds. A non-problem.
- **Context for one note** — notes run ~2 pages, so "current note + linked notes" is
  10–20k tokens. Send whole notes.
- **Retrieval across the vault** — at 1,000 notes the *list of titles* is ~15k tokens, which
  fits in context. Send all titles, let the model pick 5–10, read those whole. No chunking,
  no embeddings, nothing to go stale.

Escalation ladder, each rung a swap behind the contracts: ripgrep → SQLite FTS5 (stdlib, no
new dependency) → title-listing retrieval → embeddings, only if the first three genuinely
fail.
