# Sage

A local-first, AI-native notes and todo app. Plain markdown files on disk, a fast editor,
and a weekly todo list that generates its own work summaries.

Phase 1 is built: editor, file tree, autosave, and the core todo interactions.

## Running it

```bash
brew install node                      # once

cd backend-python && uv sync --extra dev
cd ../frontend && npm install && npm run build

cd ../backend-python && uv run sage    # opens a native window
```

For frontend hot-reload, run `npm run dev` in `frontend/` and start the app with
`SAGE_DEV=1 uv run sage`.

```bash
cd backend-python && uv run pytest     # vault conformance suite
cd frontend && npm test                # todo commands + editor save safety
```

## Your vault

Notes live **outside this repo**, at `~/notes` by default, so the vault can be its own git
repo later without entangling it with the app. Change the location in
`~/.config/sage/config.toml`.

```
~/notes/
├── todo/
│   ├── 2026-W35.md      this week — `## Now` and `## This week`
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
| Settings (reveal `.sage/`) | `⌘K` → settings |
| Quick-add from anywhere → bottom of `## This week` | `⌘⇧T`, then `↵` |
| Quick-add to the backlog instead | `⌘⇧T`, then `⇧↵` |
| Toggle done | `⌘⏎` |
| Promote to top of section | `⌘⇧↑` |
| Nudge up / down | `⌥↑` / `⌥↓` |
| Delete line | `⌘⇧K` |
| Hide completed (view only) | `⌘⇧H` |
| Force save | `⌘S` (autosaves after 500ms anyway) |
| Split pane (week + backlog) | `⌘\`, or ⌥-click a file |
| Follow a `[[link]]`, or create it if it does not exist | `⌘`-click |

Quick-add is global — it goes to this week's file regardless of which note you are
looking at, so capture never depends on where you happen to be.

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

## Two palettes, not one

`⌘K` lists commands and skills. `⌘O` lists notes, most recently opened first.

They are separate because a **file is an object and a command is an action** — mixing them
in one list is what makes a palette useless once a vault has hundreds of notes. Both are
the same component with different lists, so the split costs nothing.

## Settings is a folder

There is no settings panel. `⌘K` → Settings reveals the hidden `.sage/` directory in the
file tree, and you edit skills and config as ordinary files in the editor you already have.

```
<vault>/.sage/skills/*.md        prompts
<vault>/.sage/keybindings.toml   (Phase 4)
~/.config/sage/config.toml       machine-specific
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
`~/.config/sage/config.toml` — and never reaches the frontend bundle.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

### Skills are files

A skill is a markdown file in `<vault>/.sage/skills/`. Four ship on first run — Clean up,
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

They appear in `⌘K` alongside built-in commands, because a skill and a command are the same
kind of thing. `Edit skill: …` opens the prompt in the editor — it is a note like any other.
This is the anti-bloat mechanism in practice: the app does not grow, your skill folder does,
and a skill you stop using is a file you delete.

### Nothing is applied without review

Generated text streams into a review panel, never straight into the document. `⌘↵` accepts,
`esc` discards. Accepting wraps the text in provenance markers:

```markdown
<!-- sage:ai model=claude-opus-5 skill=expand at=2026-08-28T09:15 -->
Generated content.
<!-- /sage:ai -->
```

Generated regions render tinted, with the markers dimmed but still visible and editable — a
marker you cannot see is one you cannot remove when you have made the text your own.
"Accept as mine" inserts without markers. HTML comments because they vanish in any markdown
renderer and survive a round trip through Obsidian or `grep`.

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

### Provenance

When AI generation lands in Phase 3, generated regions are marked with HTML comments —
invisible in every renderer, and they survive round-tripping through other editors:

```markdown
<!-- sage:ai model=claude-opus-5 skill=expand at=2026-08-27T14:32 -->
Generated content.
<!-- /sage:ai -->
```

Six months on, "did I verify this or did a model assert it?" is the most important question
about any line in a vault. No pre-AI notes app has this concept, because everything in one
was human-written by definition.

## Roadmap

| Phase | Contents |
|---|---|
| **1** ✅ | Editor, file tree, autosave, three contracts, atomic writes, core todo interactions |
| **2** ✅ | `⌘K` palette, deterministic weekly rollover, backlog pull/send, wiki-links, backlinks, split view |
| **3** ✅ | Skill runner, selection transforms, ask-with-context, weekly summary, diff review, provenance |
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
