import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  backend,
  type FileNode,
  type SyncStatus,
  type WeekInfo,
  type TaskRef,
  type TaskTarget,
} from "./backend";
import { AIReview, CopyButton } from "./components/AIReview";
import { BacklinksPanel } from "./components/BacklinksPanel";
import { Switcher } from "./components/Switcher";
import { Editor, type EditorHandle } from "./components/Editor";
import { FileTree } from "./components/FileTree";
import { QuickAdd } from "./components/QuickAdd";
import { Prompt } from "./components/Prompt";
import { MultiPicker } from "./components/MultiPicker";
import { SyncIndicator } from "./components/SyncIndicator";
import type { Command } from "./lib/commands";
import { BINDINGS, label, matches } from "./lib/keybindings";
import { lineLinksTo, linkNameFor, slugify } from "./lib/wikilinks";
import type { SearchHit, SkillInfo } from "./backend";

/**
 * A pane's filename bar. Both panes render this, which is the point: the left name used
 * to live in an outer header spanning the whole area, so it sat a row above the right one
 * and no amount of height tuning could line them up.
 */
function PaneHeader({ path, onClose }: { path: string | null; onClose?: () => void }) {
  return (
    <div
      className="flex h-9 shrink-0 items-center gap-3 border-b px-4 text-xs"
      style={{ borderColor: "var(--sage-border)", color: "var(--sage-muted)" }}
    >
      <span className="min-w-0 flex-1 truncate">{path ?? "No file open"}</span>
      {onClose && (
        <button onClick={onClose} className="shrink-0" title="Close split">
          ✕
        </button>
      )}
    </div>
  );
}

/** Flatten the tree so every note is reachable from the palette. */
function flatten(nodes: FileNode[], out: FileNode[] = []): FileNode[] {
  for (const n of nodes) {
    if (n.isDir) flatten(n.children ?? [], out);
    else out.push(n);
  }
  return out;
}

export default function App() {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  // path and content are one unit: setting them separately lets the header claim one
  // file while the editor shows another.
  const [doc, setDoc] = useState<{ path: string | null; content: string }>({
    path: null,
    content: "",
  });
  const path = doc.path;
  const [quickAdd, setQuickAdd] = useState(false);
  // Three overlays, one component. Commands and files are deliberately separate lists:
  // a file is an object, a command is an action, and mixing them makes the palette
  // useless once the vault has hundreds of notes.
  const [palette, setPalette] = useState(false);
  const [switcher, setSwitcher] = useState(false);
  const [newNote, setNewNote] = useState(false);
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // A skill with `asks: true` needs a question before it can run.
  const [asking, setAsking] = useState<SkillInfo | null>(null);
  const [pulling, setPulling] = useState(false);
  const [week, setWeek] = useState<WeekInfo | null>(null);
  // Most-recently-opened first; drives ranking in the file switcher.
  const [recent, setRecent] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backlog, setBacklog] = useState<TaskRef[]>([]);
  const [backlinks, setBacklinks] = useState<SearchHit[]>([]);
  // The split pane holds its own document, so planning (week + backlog) needs no
  // special-casing — it is just two editors.
  const [split, setSplit] = useState<{ path: string; content: string } | null>(null);
  const line = useRef(1);
  const editor = useRef<EditorHandle>(null);

  // A skill run in flight. Generated text lands here for review — never straight into
  // the document.
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  // Whether a key is configured. Surfaced up front rather than discovered by running a
  // skill and getting an error.
  const [aiReady, setAiReady] = useState(true);
  const [run, setRun] = useState<{
    skill: SkillInfo;
    text: string;
    streaming: boolean;
    error: string | null;
  } | null>(null);
  const abort = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { files, sync } = await backend.listFiles(showSettings);
      setFiles(files);
      setSync(sync);
      backend.week().then(setWeek).catch(() => {});
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [showSettings]);

  const open = useCallback(async (p: string) => {
    try {
      const content = await backend.readFile(p);
      setDoc({ path: p, content });
      setRecent((r) => [p, ...r.filter((x) => x !== p)].slice(0, 50));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  // On first load, open this week's todo file — the daily starting point.
  useEffect(() => {
    (async () => {
      await refresh();
      try {
        const week = await backend.week();
        await open(week.path);
        await refresh(); // the week file may have just been created
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [refresh, open]);

  /**
   * Create a note and open it. Shared by ⌘N and by ⌘-clicking an unresolved [[link]] —
   * both are "make this note exist", so they are one path.
   */
  const createNote = useCallback(
    async (name: string, folder = "notes") => {
      const slug = slugify(name);
      if (!slug) return;
      const path = `${folder}/${slug}.md`;
      try {
        const existing = await backend.listFiles();
        const already = JSON.stringify(existing.files).includes(`"${path}"`);
        if (!already) await backend.writeFile(path, `# ${name.trim()}\n\n`);
        await refresh();
        await open(path);
      } catch (e) {
        setError(String(e));
      }
    },
    [open, refresh],
  );

  const openSplit = useCallback(async (p: string) => {
    try {
      setSplit({ path: p, content: await backend.readFile(p) });
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const runSkill = useCallback(
    async (skill: SkillInfo, instruction?: string) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;

      const selection = editor.current?.selection() ?? "";
      setRun({ skill, text: "", streaming: true, error: null });

      try {
        for await (const chunk of backend.runSkill(
          { skill: skill.id, notePath: path, selection, instruction },
          controller.signal,
        )) {
          setRun((r) => (r ? { ...r, text: r.text + chunk } : r));
        }
        setRun((r) => (r ? { ...r, streaming: false } : r));
      } catch (e) {
        if (controller.signal.aborted) return;
        setRun((r) =>
          r ? { ...r, streaming: false, error: String(e) } : r,
        );
      }
    },
    [path],
  );

  const acceptRun = useCallback(
    () => {
      if (!run) return;
      if (!editor.current) {
        // Previously a silent return, which made a missing editor ref look like a
        // button that simply did nothing. Say so instead.
        setError("Cannot apply: no editor is focused. Open a note and try again.");
        return;
      }
      editor.current.apply(run.text.trim(), run.skill.mode);
      setRun(null);
    },
    [run],
  );

  const rejectRun = useCallback(() => {
    abort.current?.abort();
    setRun(null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [showSettings, refresh]);

  const save = useCallback(async (p: string, body: string) => {
    try {
      await backend.writeFile(p, body);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const addTask = useCallback(
    async (text: string, target: TaskTarget) => {
      try {
        const { path: written } = await backend.quickAdd(text, target);
        await refresh();
        // Reload if the file being edited is the one that just changed.
        if (written === path) {
          setDoc({ path: written, content: await backend.readFile(written) });
        }
      } catch (e) {
        setError(String(e));
      }
    },
    [path, refresh],
  );

  // Backlinks ride on search() — no index to rebuild, nothing to go stale. The literal
  // search over-matches (`[[cloud` also hits `[[cloud-old]]`), so each hit is re-parsed.
  useEffect(() => {
    if (!path) return setBacklinks([]);
    let cancelled = false;
    const name = linkNameFor(path);

    backend
      .search(`[[${name}`)
      .then((hits) => {
        if (cancelled) return;
        setBacklinks(
          hits.filter((h) => h.path !== path && lineLinksTo(h.text, path, files)),
        );
      })
      .catch(() => !cancelled && setBacklinks([]));

    return () => {
      cancelled = true;
    };
  }, [path, files]);

  // Rebuilt whenever the vault changes so "Open …" always reflects what is on disk.
  // In Phase 3, skills from .sage/skills/ append to this same list.
  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      {
        id: "todo.week",
        group: "Todo",
        title: "Open this week",
        keywords: "todo current",
        hint: `${label(BINDINGS.quickAdd)} adds`,
        run: async () => open((await backend.week()).path),
      },
      {
        id: "todo.rollover",
        group: "Todo",
        title: "Roll unfinished work into this week",
        keywords: "new week rollover carry forward",
        run: async () => {
          try {
            const r = await backend.rollover();
            await refresh();
            if (r.target === path) await open(r.target);

            if (!r.source) setStatus("No earlier week to roll from");
            else if (!r.moved.length && r.skipped)
              setStatus(`Already up to date (${r.skipped} already here)`);
            else if (!r.moved.length) setStatus("Nothing unfinished to carry");
            else {
              const stale = r.stale.length
                ? ` · ${r.stale.length} rolled 5+ times: ${r.stale.join(", ")}`
                : "";
              setStatus(`Carried ${r.moved.length} from ${r.source}${stale}`);
            }
          } catch (e) {
            setError(String(e));
          }
        },
      },
      {
        id: "note.new",
        group: "Notes",
        title: "New note",
        keywords: "create add page",
        hint: label(BINDINGS.newNote),
        run: () => setNewNote(true),
      },
      {
        id: "vault.search",
        group: "Notes",
        title: "Search the vault",
        keywords: "find grep text",
        hint: label(BINDINGS.search),
        run: () => setSearching(true),
      },
      {
        id: "note.delete",
        group: "Notes",
        title: "Delete this note…",
        keywords: "remove trash",
        hint: label(BINDINGS.deleteNote),
        run: () => setConfirmDelete(true),
      },
      {
        id: "note.rename",
        group: "Notes",
        title: "Rename this note (updates links)",
        keywords: "move title",
        run: () => setRenaming(true),
      },
      {
        id: "config.open",
        group: "Settings",
        title: aiReady
          ? "Open Sage config (API key, vault path)"
          : "Set the Anthropic API key…",
        keywords: "anthropic claude api key config toml machine settings",
        hint: aiReady ? undefined : "no key set",
        run: async () => {
          try {
            const { path } = await backend.openConfig();
            setStatus(`Opened ${path} — restart Sage after editing`);
          } catch {
            const { path } = await backend.config();
            setStatus(`Edit ${path}, then restart Sage`);
          }
        },
      },
      {
        id: "vault.settings",
        group: "Settings",
        title: showSettings ? "Hide settings" : "Settings (show .sage folder)",
        keywords: "config skills keybindings preferences",
        run: () => setShowSettings((v) => !v),
      },
      {
        id: "view.cheatsheet",
        group: "View",
        title: "Markdown cheat sheet (in split pane)",
        keywords: "help syntax reference formatting",
        run: () => openSplit(".sage/markdown.md"),
      },
      {
        id: "view.split",
        group: "View",
        title: split ? "Close split pane" : "Open backlog in a split pane",
        keywords: "side by side planning two panes",
        hint: "⌘\\",
        run: async () => {
          if (split) return setSplit(null);
          const { backlogs } = await backend.week();
          if (backlogs[0]) await openSplit(backlogs[0]);
        },
      },
      {
        id: "todo.send",
        group: "Todo",
        title: "Send this task to the backlog",
        keywords: "move defer not this week",
        run: async () => {
          if (!path) return;
          try {
            const { backlogs } = await backend.week();
            if (!backlogs[0]) return setError("No backlog file");
            await backend.moveTask(path, line.current, backlogs[0]);
            await open(path);
            await refresh();
            setStatus(`Moved to ${backlogs[0]}`);
          } catch (e) {
            setError(String(e));
          }
        },
      },
      {
        id: "todo.pull",
        group: "Todo",
        title: "Pull tasks from the backlog…",
        keywords: "backlog take plan week multiple",
        hint: backlog.length ? `${backlog.length} waiting` : undefined,
        run: () => setPulling(true),
      },
      {
        id: "todo.backlog",
        group: "Todo",
        title: "Open backlog",
        keywords: "todo someday",
        run: async () => {
          const { backlogs } = await backend.week();
          if (backlogs[0]) await open(backlogs[0]);
        },
      },
    ];

    for (const sk of skills) {
      list.push({
        id: `skill:${sk.id}`,
        title: sk.title,
        group: "AI",
        keywords: `ai skill ${sk.context} ${sk.mode}`,
        hint: aiReady
          ? sk.context === "selection"
            ? "selection"
            : sk.context
          : "needs API key",
        run: () => (sk.asks ? setAsking(sk) : runSkill(sk)),
      });
      list.push({
        id: `skill-reset:${sk.id}`,
        group: "Settings",
        title: `Reset skill to default: ${sk.title}`,
        keywords: `restore original prompt ${sk.id}`,
        run: async () => {
          try {
            await backend.resetSkill(sk.id);
            const r = await backend.skills();
            setSkills(r.skills);
            await refresh();
            setStatus(`Reset ${sk.title} to its shipped default`);
          } catch (e) {
            setError(String(e));
          }
        },
      });
      list.push({
        id: `skill-edit:${sk.id}`,
        title: `Edit skill: ${sk.title}`,
        group: "Settings",
        keywords: `prompt ${sk.path}`,
        hint: sk.path,
        run: () => open(sk.path),
      });
    }

    // Files live in ⌘O, not here — see the note on the overlay state above.
    return list;
  }, [path, backlog, split, skills, aiReady, showSettings, open, openSplit, refresh, runSkill]);

  const fileCommands = useMemo<Command[]>(
    () =>
      flatten(files).map((f) => {
        const seen = recent.indexOf(f.path);
        return {
          id: `open:${f.path}`,
          title: f.name.replace(/\.md$/, ""),
          keywords: f.path,
          hint: f.path,
          // Unseen files sort after every recently-opened one.
          rank: seen === -1 ? 1000 : seen,
          run: () => open(f.path),
        };
      }),
    [files, recent, open],
  );

  const searchCommands = useMemo<Command[]>(
    () =>
      hits.map((h, i) => ({
        id: `hit:${h.path}:${h.line}:${i}`,
        title: h.text,
        keywords: h.path,
        hint: `${h.path.replace(/\.md$/, "")}:${h.line}`,
        run: () => open(h.path),
      })),
    [hits, open],
  );

  // ⌘K is the single invocation surface; ⌘⇧T is the one capture shortcut worth its own key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Every branch goes through matches(), which refuses to treat Ctrl as Cmd on
      // macOS — otherwise ⌃K would open this palette instead of killing to end of line.
      if (matches(e, BINDINGS.switcher)) {
        e.preventDefault();
        setSwitcher(true);
      } else if (matches(e, BINDINGS.newNote)) {
        e.preventDefault();
        setNewNote(true);
      } else if (matches(e, BINDINGS.search)) {
        e.preventDefault();
        setSearching(true);
      } else if (matches(e, BINDINGS.palette)) {
        e.preventDefault();
        // Refresh backlog entries so "Pull: …" reflects the file, not a stale snapshot.
        backend.backlogTasks().then(setBacklog).catch(() => setBacklog([]));
        // Skills are vault files, so re-read them rather than trusting a snapshot —
        // editing a prompt takes effect on the next palette open.
        backend
          .skills()
          .then((r) => {
            setSkills(r.skills);
            setAiReady(r.available);
          })
          .catch(() => setSkills([]));
        setPalette(true);
      } else if (matches(e, BINDINGS.quickAdd)) {
        e.preventDefault();
        setQuickAdd(true);
      } else if (matches(e, BINDINGS.pull)) {
        e.preventDefault();
        backend.backlogTasks().then(setBacklog).catch(() => setBacklog([]));
        setPulling(true);
      } else if (matches(e, BINDINGS.deleteNote)) {
        e.preventDefault();
        setConfirmDelete(true);
      } else if (matches(e, BINDINGS.split)) {
        e.preventDefault();
        if (split) setSplit(null);
        else {
          backend.week().then((w) => {
            if (w.backlogs[0]) void openSplit(w.backlogs[0]);
          });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [split, openSplit]);

  // Status messages are transient; errors stay until the next action.
  useEffect(() => {
    if (!status) return;
    const t = window.setTimeout(() => setStatus(null), 6000);
    return () => window.clearTimeout(t);
  }, [status]);

  return (
    <div className="flex h-full">
      <aside
        className="flex w-60 shrink-0 flex-col border-r"
        style={{ background: "var(--sage-panel)", borderColor: "var(--sage-border)" }}
      >
        <div
          className="flex items-center justify-between border-b px-3 py-2"
          style={{ borderColor: "var(--sage-border)" }}
        >
          <span className="text-xs font-semibold tracking-wide">SAGE</span>
          <SyncIndicator status={sync} />
        </div>
        {week && (
          <div
            className="shrink-0 border-b px-2 py-2"
            style={{ borderColor: "var(--sage-border)" }}
          >
            {[
              { path: week.path, label: "This week", sub: week.label },
              ...(week.backlogs[0]
                ? [{ path: week.backlogs[0], label: "Backlog", sub: "" }]
                : []),
            ].map((row) => (
              <button
                key={row.path}
                onClick={() => open(row.path)}
                className="flex w-full items-baseline gap-2 rounded px-2 py-[3px] text-left text-sm"
                style={{
                  background:
                    row.path === path
                      ? "color-mix(in srgb, var(--sage-accent) 14%, transparent)"
                      : undefined,
                  color: row.path === path ? "var(--sage-accent)" : "var(--sage-fg)",
                }}
              >
                <span className="flex-1 truncate">{row.label}</span>
                {row.sub && (
                  <span className="shrink-0 text-[11px]" style={{ color: "var(--sage-muted)" }}>
                    {row.sub}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
        <div className="flex-1 overflow-auto">
          <FileTree
            nodes={files}
            selected={path}
            onOpen={open}
            onOpenAlt={openSplit}
          />
        </div>
        <div
          className="border-t px-3 py-2 text-[11px]"
          style={{ borderColor: "var(--sage-border)", color: "var(--sage-muted)" }}
        >
          {label(BINDINGS.palette)} commands · {label(BINDINGS.switcher)} files ·{" "}
          {label(BINDINGS.search)} search · {label(BINDINGS.newNote)} new
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {error && (
          <div className="flex items-start gap-3 px-4 py-2">
            <div
              className="cm-selectable min-w-0 flex-1 whitespace-pre-wrap text-xs"
              style={{ color: "#ef4444" }}
            >
              {error}
            </div>
            <CopyButton text={error} />
            <button
              onClick={() => setError(null)}
              className="shrink-0 px-1 text-xs"
              style={{ color: "var(--sage-muted)" }}
            >
              ✕
            </button>
          </div>
        )}
        {status && (
          <div
            className="border-b px-4 py-2 text-xs"
            style={{
              borderColor: "var(--sage-border)",
              color: "var(--sage-muted)",
              background: "color-mix(in srgb, var(--sage-accent) 6%, transparent)",
            }}
          >
            {status}
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <PaneHeader path={doc.path} />
            <div className="min-h-0 flex-1">
            <Editor
              path={doc.path}
              content={doc.content}
              onSave={save}
              onCursor={(n) => (line.current = n)}
              files={files}
              onOpenLink={open}
              onCreateLink={(name) => void createNote(name)}
              ref={editor}
            />
            </div>
          </div>
          {split && (
            <div
              className="flex min-w-0 flex-1 flex-col border-l"
              style={{ borderColor: "var(--sage-border)" }}
            >
              <PaneHeader path={split.path} onClose={() => setSplit(null)} />
              <div className="min-h-0 flex-1">
                <Editor
                  path={split.path}
                  content={split.content}
                  onSave={save}
                  files={files}
                  onOpenLink={open}
                />
              </div>
            </div>
          )}
        </div>
        <AIReview
          skill={run?.skill ?? null}
          text={run?.text ?? ""}
          streaming={run?.streaming ?? false}
          error={run?.error ?? null}
          onAccept={acceptRun}
          onReject={rejectRun}
        />
        <BacklinksPanel hits={backlinks} onOpen={open} />
      </main>

      <QuickAdd open={quickAdd} onClose={() => setQuickAdd(false)} onSubmit={addTask} />
      <Switcher
        open={palette}
        items={commands}
        placeholder="Type a command…"
        footer={`${label(BINDINGS.switcher)} files · ${label(BINDINGS.search)} search`}
        onClose={() => setPalette(false)}
        emptyLabel="No matching command"
      />
      <Switcher
        open={switcher}
        items={fileCommands}
        placeholder="Open a note…"
        footer={`recently opened first · ${label(BINDINGS.palette)} for commands`}
        onClose={() => setSwitcher(false)}
        emptyLabel="No matching note"
      />
      <Switcher
        open={searching && hits.length > 0}
        items={searchCommands}
        placeholder="Results"
        onClose={() => {
          setSearching(false);
          setHits([]);
        }}
        emptyLabel="No matches"
      />
      <Prompt
        open={searching && hits.length === 0}
        label="Search the vault"
        placeholder="Find text in any note…"
        onClose={() => setSearching(false)}
        onSubmit={async (q) => {
          try {
            const found = await backend.search(q);
            if (found.length) setHits(found);
            else {
              setSearching(false);
              setStatus(`No matches for "${q}"`);
            }
          } catch (e) {
            setSearching(false);
            setError(String(e));
          }
        }}
      />
      <Prompt
        open={newNote}
        label="New note"
        placeholder="Note name…"
        onClose={() => setNewNote(false)}
        onSubmit={(name) => {
          setNewNote(false);
          void createNote(name);
        }}
      />
      <MultiPicker
        open={pulling}
        title="Pull into this week"
        items={backlog.map((t) => ({
          id: `${t.path}:${t.line}`,
          label: t.text,
          hint: t.rolled ? `rolled ${t.rolled}×` : t.path.replace(/^todo\//, ""),
        }))}
        emptyLabel="Backlog is empty"
        confirmLabel={(n) => (n ? `Pull ${n}` : "Pull")}
        onClose={() => setPulling(false)}
        onConfirm={async (ids) => {
          try {
            const week = (await backend.week()).path;
            // Highest line first: removing a line shifts everything below it, so
            // descending order keeps the remaining line numbers valid.
            const chosen = ids
              .map((id) => backlog.find((t) => `${t.path}:${t.line}` === id)!)
              .filter(Boolean)
              .sort((a, b) => b.line - a.line);

            for (const t of chosen) await backend.moveTask(t.path, t.line, week);

            await open(week);
            await refresh();
            setBacklog(await backend.backlogTasks());
            setStatus(`Pulled ${chosen.length} into this week`);
          } catch (e) {
            setError(String(e));
          }
        }}
      />
      <Prompt
        open={!!asking}
        label={asking ? `${asking.title} — this note and everything it links to` : ""}
        placeholder="What do you want to know?"
        onClose={() => setAsking(null)}
        onSubmit={(question) => {
          const sk = asking;
          setAsking(null);
          if (sk) void runSkill(sk, question);
        }}
      />
      <Prompt
        open={confirmDelete && !!path}
        label={`Delete ${path ?? ""}? Type the note name to confirm — this cannot be undone.`}
        placeholder={path ? path.split("/").pop()!.replace(/\.md$/, "") : ""}
        onClose={() => setConfirmDelete(false)}
        onSubmit={async (typed) => {
          if (!path) return;
          const expected = path.split("/").pop()!.replace(/\.md$/, "");
          if (typed !== expected) {
            setStatus(`Not deleted — type "${expected}" exactly to confirm`);
            return;
          }
          setConfirmDelete(false);
          try {
            await backend.deleteFile(path);
            setDoc({ path: null, content: "" });
            setRecent((r) => r.filter((x) => x !== path));
            await refresh();
            const week = await backend.week();
            await open(week.path);
            setStatus(`Deleted ${path}`);
          } catch (e) {
            setError(String(e));
          }
        }}
      />
      <Prompt
        open={renaming}
        label="Rename note (inbound links are updated)"
        placeholder={path ?? ""}
        initial={path ? path.replace(/\.md$/, "") : ""}
        onClose={() => setRenaming(false)}
        onSubmit={async (next) => {
          setRenaming(false);
          if (!path) return;
          try {
            const r = await backend.rename(path, next);
            await refresh();
            await open(r.newPath);
            setStatus(
              r.updated.length
                ? `Renamed · updated links in ${r.updated.length} note${r.updated.length > 1 ? "s" : ""}`
                : "Renamed",
            );
          } catch (e) {
            setError(String(e));
          }
        }}
      />
    </div>
  );
}
