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
import { AskPanel } from "./components/AskPanel";
import { Switcher } from "./components/Switcher";
import { Editor, type EditorHandle } from "./components/Editor";
import { FileTree } from "./components/FileTree";
import { QuickAdd } from "./components/QuickAdd";
import { Prompt } from "./components/Prompt";
import { Confirm } from "./components/Confirm";
import { ContextMenu, type MenuItem } from "./components/ContextMenu";
import { MultiPicker } from "./components/MultiPicker";
import { SyncIndicator } from "./components/SyncIndicator";
import type { Command } from "./lib/commands";
import { BINDINGS, applyOverrides, binding, label, matches } from "./lib/keybindings";
import { lineLinksTo, linkNameFor, slugify } from "./lib/wikilinks";

/** The note's own title: its first `# heading`, else the filename. */
function titleOf(content: string, path: string | null): string {
  const heading = content.match(/^#\s+(.+)$/m);
  if (heading) return heading[1].trim();
  return path ? path.split("/").pop()!.replace(/\.md$/, "") : "";
}
import type { SearchHit, SkillInfo } from "./backend";

/**
 * A pane's filename bar. Both panes render this, which is the point: the left name used
 * to live in an outer header spanning the whole area, so it sat a row above the right one
 * and no amount of height tuning could line them up.
 */
function PaneHeader({
  path,
  links,
  onLinks,
  onClose,
}: {
  path: string | null;
  /** Inbound link count, shown as a number rather than a permanent panel. */
  links?: number;
  onLinks?: () => void;
  onClose?: () => void;
}) {
  return (
    <div
      className="flex h-9 shrink-0 items-center gap-3 border-b px-4 text-xs"
      style={{ borderColor: "var(--ink-border)", color: "var(--ink-muted)" }}
    >
      <span className="min-w-0 flex-1 truncate">{path ?? "No file open"}</span>
      {!!links && (
        <button
          onClick={onLinks}
          className="shrink-0"
          style={{ color: "var(--ink-accent)" }}
          title="Notes linking here"
        >
          ← {links}
        </button>
      )}
      {onClose && (
        <button onClick={onClose} className="shrink-0" title="Close split">
          ✕
        </button>
      )}
    </div>
  );
}

/** Short labels for the shortcut cheat sheet. */
const HINTS: Record<string, string> = {
  switcher: "notes",
  search: "search",
  newNote: "note",
  quickAdd: "task",
  startMeeting: "meeting",
  ask: "ask",
  meeting: "paste recap",
  split: "split",
};

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
  // Mirrors doc.path so callbacks can read the currently open note without listing it as
  // a dependency and rebuilding themselves on every navigation.
  const path0 = useRef<string | null>(null);
  const path = doc.path;
  path0.current = path;
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
  const [showKeys, setShowKeys] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [moving, setMoving] = useState(false);
  const [startingMeeting, setStartingMeeting] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState(false);
  const [folderTarget, setFolderTarget] = useState<string | null>(null);
  const [menu, setMenu] = useState<{
    at: { x: number; y: number };
    items: MenuItem[];
  } | null>(null);
  // A skill with `asks: true` needs a question before it can run.
  const [asking, setAsking] = useState<SkillInfo | null>(null);
  const [pulling, setPulling] = useState(false);
  const [week, setWeek] = useState<WeekInfo | null>(null);
  const [asking2, setAsking2] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [showBacklinks, setShowBacklinks] = useState(false);
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

  /**
   * Paste a meeting recap in, and go straight to proposed follow-ups.
   *
   * Two steps rather than one command each way: the note is written immediately so the
   * record exists even if extraction fails or is interrupted, and only then does the
   * question go to the panel.
   */
  const meetingFromClipboard = useCallback(async () => {
    try {
      // Pass the open note: if it is a meeting, the recap joins it rather than starting a
      // second note about the same meeting.
      const { path, title, followUpPrompt } = await backend.meetingFromClipboard(path0.current);
      await refresh();
      await open(path);
      setStatus(title ? `Meeting note: ${title}` : "Recap added to this meeting");
      setAsking2(true);
      setPendingQuestion(followUpPrompt);
    } catch (e) {
      setError(String(e));
    }
  }, [open, refresh]);

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

  // Overrides load once at startup. A problem in the file is surfaced rather than
  // swallowed: a shortcut that silently does nothing is the worst way to learn about a typo.
  const [keysLoaded, setKeysLoaded] = useState(0);
  useEffect(() => {
    backend
      .keybindings(BINDINGS)
      .then(({ overrides, problems }) => {
        applyOverrides(overrides);
        setKeysLoaded((n) => n + 1);
        if (problems.length) setStatus(`Keybindings: ${problems.join("; ")}`);
      })
      .catch(() => {});
  }, []);

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
  // In Phase 3, skills from .occam/skills/ append to this same list.
  /** Run a palette command by id, so the key table need not duplicate its body. */
  const commandsRef = useRef<Command[]>([]);
  const runCommand = useCallback((id: string) => {
    void commandsRef.current.find((c) => c.id === id)?.run();
  }, []);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      {
        id: "todo.week",
        group: "Todo",
        title: "Open this week",
        keywords: "todo current",
        hint: `${label(binding("quickAdd"))} adds`,
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
        id: "ask.panel",
        group: "AI",
        title: "Ask the vault…",
        keywords: "question chat search across notes",
        hint: label(binding("ask")),
        run: () => setAsking2(true),
      },
      {
        id: "ai.undo",
        group: "AI",
        title: "Undo last change",
        keywords: "revert restore",
        run: async () => {
          try {
            const { restored } = await backend.undoLastChange();
            await refresh();
            if (path) await open(path);
            setStatus(`Reverted ${restored.length} file${restored.length > 1 ? "s" : ""}`);
          } catch (e) {
            setError(String(e));
          }
        },
      },
      {
        id: "meeting.start",
        group: "Notes",
        title: "Start a meeting note",
        keywords: "new meeting live notes during",
        hint: label(binding("startMeeting")),
        run: () => setStartingMeeting(true),
      },
      {
        id: "folder.rename",
        group: "Notes",
        title: "Rename this note's folder…",
        keywords: "directory section reorganise move all",
        run: () => setRenamingFolder(true),
      },
      {
        id: "note.move",
        group: "Notes",
        title: "Move this note to another folder…",
        keywords: "reassign relocate folder meetings notes",
        run: () => setMoving(true),
      },
      {
        id: "meeting.paste",
        group: "Notes",
        title: "Paste recap (into this meeting, or a new one)",
        keywords: "paste recap teams loop minutes actions commitments",
        hint: label(binding("meeting")),
        run: meetingFromClipboard,
      },
      {
        id: "note.new",
        group: "Notes",
        title: "New note",
        keywords: "create add page",
        hint: label(binding("newNote")),
        run: () => setNewNote(true),
      },
      {
        id: "vault.search",
        group: "Notes",
        title: "Search the vault",
        keywords: "find grep text",
        hint: label(binding("search")),
        run: () => setSearching(true),
      },
      {
        id: "note.archive",
        group: "Notes",
        title: "Archive this note",
        keywords: "move away done finished old week",
        run: async () => {
          if (!path) return;
          try {
            const { path: target } = await backend.archiveNote(path);
            setDoc({ path: null, content: "" });
            await refresh();
            const week = await backend.week();
            await open(week.path);
            setStatus(`Archived to ${target} — ⌘K → undo to restore`);
          } catch (e) {
            setError(String(e));
          }
        },
      },
      {
        id: "note.delete",
        group: "Notes",
        title: "Delete this note…",
        keywords: "remove trash",
        hint: label(binding("deleteNote")),
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
          ? "Open config (API key, vault path)"
          : "Set the Anthropic API key…",
        keywords: "anthropic claude api key config toml machine settings",
        hint: aiReady ? undefined : "no key set",
        run: async () => {
          try {
            const { path } = await backend.openConfig();
            setStatus(`Opened ${path} — restart Occam Notes after editing`);
          } catch {
            const { path } = await backend.config();
            setStatus(`Edit ${path}, then restart Occam Notes`);
          }
        },
      },
      {
        id: "keys.edit",
        group: "Settings",
        title: "Edit keybindings",
        keywords: "shortcuts keys remap rebind",
        run: async () => {
          try {
            const { path: p } = await backend.editKeybindings(BINDINGS);
            setShowSettings(true);
            await refresh();
            await open(p);
            setStatus("Edit and restart for the new bindings to take effect");
          } catch (e) {
            setError(String(e));
          }
        },
      },
      {
        id: "vault.settings",
        group: "Settings",
        title: showSettings ? "Hide settings" : "Settings (show .occam folder)",
        keywords: "config skills keybindings preferences",
        run: () => setShowSettings((v) => !v),
      },
      {
        id: "view.cheatsheet",
        group: "View",
        title: "Markdown cheat sheet (in split pane)",
        keywords: "help syntax reference formatting",
        run: () => openSplit(".occam/markdown.md"),
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
    commandsRef.current = list;
    return list;
  }, [path, backlog, split, skills, aiReady, showSettings, keysLoaded, open, openSplit, refresh, runSkill, meetingFromClipboard]);

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

  // Every bindable action in one table, keyed by binding name. The handler walks it
  // rather than an if-chain, so a command listed in keybindings.ts is automatically
  // reachable from a key the moment someone gives it one.
  const actions = useMemo<Record<string, () => void>>(
    () => ({
      palette: () => {
        // Refresh both so "Pull: …" and the skill list reflect the files, not a snapshot.
        backend.backlogTasks().then(setBacklog).catch(() => setBacklog([]));
        backend
          .skills()
          .then((r) => {
            setSkills(r.skills);
            setAiReady(r.available);
          })
          .catch(() => setSkills([]));
        setPalette(true);
      },
      switcher: () => setSwitcher(true),
      newNote: () => setNewNote(true),
      search: () => setSearching(true),
      quickAdd: () => setQuickAdd(true),
      ask: () => setAsking2((v) => !v),
      startMeeting: () => setStartingMeeting(true),
      meeting: () => void meetingFromClipboard(),
      deleteNote: () => setConfirmDelete(true),
      moveNote: () => setMoving(true),
      renameNote: () => setRenaming(true),
      settings: () => setShowSettings((v) => !v),
      pull: () => {
        backend.backlogTasks().then(setBacklog).catch(() => setBacklog([]));
        setPulling(true);
      },
      split: () => {
        if (split) setSplit(null);
        else {
          backend.week().then((w) => {
            if (w.backlogs[0]) void openSplit(w.backlogs[0]);
          });
        }
      },
      cheatsheet: () => void openSplit(".occam/markdown.md"),
      week: () => void backend.week().then((w) => open(w.path)),
      backlog: () => {
        void backend.week().then((w) => {
          if (w.backlogs[0]) void open(w.backlogs[0]);
        });
      },
      rollover: () => void runCommand("todo.rollover"),
      archiveNote: () => void runCommand("note.archive"),
      undo: () => void runCommand("ai.undo"),
    }),
    [split, meetingFromClipboard, openSplit, open, runCommand],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      for (const [name, run] of Object.entries(actions)) {
        if (matches(e, binding(name as never))) {
          e.preventDefault();
          run();
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actions]);

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
        style={{ background: "var(--ink-panel)", borderColor: "var(--ink-border)" }}
      >
        <div
          className="flex h-9 shrink-0 items-center justify-between border-b px-3"
          style={{ borderColor: "var(--ink-border)" }}
        >
          <span className="text-xs font-semibold tracking-wide">OCCAM</span>
          <SyncIndicator status={sync} />
        </div>
        {week && (
          <div
            className="shrink-0 border-b px-2 py-2"
            style={{ borderColor: "var(--ink-border)" }}
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
                      ? "color-mix(in srgb, var(--ink-accent) 14%, transparent)"
                      : undefined,
                  color: row.path === path ? "var(--ink-accent)" : "var(--ink-fg)",
                }}
              >
                <span className="flex-1 truncate">{row.label}</span>
                {row.sub && (
                  <span className="shrink-0 text-[11px]" style={{ color: "var(--ink-muted)" }}>
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
            onRename={async (target, name) => {
              try {
                if (target.isDir) {
                  const folder = target.path.split("/").slice(0, -1).join("/");
                  const next = folder ? `${folder}/${slugify(name)}` : slugify(name);
                  const { moved } = await backend.renameFolder(target.path, next);
                  await refresh();
                  setStatus(`Moved ${moved.length} note${moved.length > 1 ? "s" : ""}`);
                  return;
                }
                const folder = target.path.split("/").slice(0, -1).join("/");
                const file = slugify(name);
                if (!file) return;
                const r = await backend.rename(
                  target.path,
                  folder ? `${folder}/${file}` : file,
                  name,
                );
                await refresh();
                // Follow the note only if it was the one open; renaming from the sidebar
                // should not yank you out of what you were reading.
                if (target.path === path) await open(r.newPath);
                setStatus(
                  r.updated.length
                    ? `Renamed · ${r.updated.length} link${r.updated.length > 1 ? "s" : ""} updated`
                    : "Renamed",
                );
              } catch (e) {
                setError(String(e));
              }
            }}
            onContext={(target, at) => {
              // Acting on the right-clicked note rather than the open one, which is what
              // a context menu means; so it is opened first and the command follows.
              const items: MenuItem[] = target.isDir
                ? [
                    {
                      label: "Rename folder…",
                      run: () => {
                        setFolderTarget(target.path);
                        setRenamingFolder(true);
                      },
                    },
                    { label: "New note here…", run: () => setNewNote(true) },
                  ]
                : [
                    { label: "Open in split", run: () => void openSplit(target.path) },
                    {
                      label: "Rename…",
                      run: () => void open(target.path).then(() => setRenaming(true)),
                    },
                    {
                      label: "Move…",
                      run: () => void open(target.path).then(() => setMoving(true)),
                    },
                    {
                      label: "Archive",
                      run: () => void open(target.path).then(() => runCommand("note.archive")),
                    },
                    {
                      label: "Delete…",
                      danger: true,
                      run: () => void open(target.path).then(() => setConfirmDelete(true)),
                    },
                  ];
              setMenu({ at, items });
            }}
          />
        </div>
        <button
          onClick={() => setShowKeys((v) => !v)}
          className="shrink-0 border-t px-3 py-1.5 text-left text-[11px]"
          style={{ borderColor: "var(--ink-border)", color: "var(--ink-muted)" }}
          title="Keyboard shortcuts"
        >
          {showKeys ? "▾" : "▸"} {label(binding("palette"))} commands
        </button>
        {showKeys && (
          <div
            className="shrink-0 space-y-0.5 border-t px-3 py-2 text-[11px]"
            style={{ borderColor: "var(--ink-border)", color: "var(--ink-muted)" }}
          >
            {[
              ["Find", ["switcher", "search"]],
              ["New", ["newNote", "quickAdd", "startMeeting"]],
              ["AI", ["ask", "meeting"]],
              ["View", ["split"]],
            ].map(([group, names]) => (
              <div key={group as string} className="flex gap-2">
                <span className="w-10 shrink-0 opacity-60">{group}</span>
                <span className="min-w-0 flex-1">
                  {(names as string[])
                    .map((n) => `${label(binding(n as never))} ${HINTS[n]}`)
                    .join(" · ")}
                </span>
              </div>
            ))}
          </div>
        )}
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {status && (
          <div
            className="border-b px-4 py-2 text-xs"
            style={{
              borderColor: "var(--ink-border)",
              color: "var(--ink-muted)",
              background: "color-mix(in srgb, var(--ink-accent) 6%, transparent)",
            }}
          >
            {status}
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <PaneHeader
              path={doc.path}
              links={backlinks.length}
              onLinks={() => setShowBacklinks(true)}
            />
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
              style={{ borderColor: "var(--ink-border)" }}
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
              style={{ color: "var(--ink-muted)" }}
            >
              ✕
            </button>
          </div>
        )}
        <AIReview
          skill={run?.skill ?? null}
          text={run?.text ?? ""}
          streaming={run?.streaming ?? false}
          error={run?.error ?? null}
          onAccept={acceptRun}
          onReject={rejectRun}
        />
      </main>

      <AskPanel
        open={asking2}
        pending={pendingQuestion}
        onPendingConsumed={() => setPendingQuestion(null)}
        onClose={() => setAsking2(false)}
        onOpenNote={open}
        onApplied={async () => {
          await refresh();
          if (path) await open(path);
          setStatus("Applied — ⌘K → undo to revert");
        }}
      />
      <ContextMenu
        at={menu?.at ?? null}
        items={menu?.items ?? []}
        onClose={() => setMenu(null)}
      />
      <QuickAdd open={quickAdd} onClose={() => setQuickAdd(false)} onSubmit={addTask} />
      <Switcher
        open={palette}
        items={commands}
        placeholder="Type a command…"
        footer={`${label(binding("switcher"))} files · ${label(binding("search"))} search`}
        onClose={() => setPalette(false)}
        emptyLabel="No matching command"
      />
      <Switcher
        open={showBacklinks}
        items={backlinks.map((h) => ({
          id: `bl:${h.path}:${h.line}`,
          title: h.text,
          keywords: h.path,
          hint: h.path.replace(/^notes\//, "").replace(/\.md$/, ""),
          run: () => open(h.path),
        }))}
        placeholder="Notes linking here…"
        onClose={() => setShowBacklinks(false)}
        emptyLabel="Nothing links here yet"
      />
      <Switcher
        open={switcher}
        items={fileCommands}
        placeholder="Open a note…"
        footer={`recently opened first · ${label(binding("palette"))} for commands`}
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
        label="New note — a slash makes a folder"
        placeholder="vendor-risk, or governance/vendor-risk"
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
      <Confirm
        open={confirmDelete && !!path}
        title={`Delete ${path}?`}
        detail="⌘K → Undo last change will bring it back."
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          setConfirmDelete(false);
          if (!path) return;
          try {
            await backend.deleteFile(path);
            setDoc({ path: null, content: "" });
            setRecent((r) => r.filter((x) => x !== path));
            await refresh();
            const week = await backend.week();
            await open(week.path);
            setStatus(`Deleted ${path} — ⌘K → undo to restore`);
          } catch (e) {
            setError(String(e));
          }
        }}
      />
      <Prompt
        open={startingMeeting}
        label="Start a meeting note"
        placeholder="What is the meeting? (blank uses the time)"
        onClose={() => setStartingMeeting(false)}
        onSubmit={async (title) => {
          setStartingMeeting(false);
          try {
            const { path: p } = await backend.startMeeting(title);
            await refresh();
            await open(p);
            setStatus(`${label(binding("meeting"))} to add the recap afterwards`);
          } catch (e) {
            setError(String(e));
          }
        }}
      />
      <Prompt
        open={renamingFolder && !!(folderTarget ?? path?.includes("/"))}
        label={`Rename ${folderTarget ?? path?.split("/").slice(0, -1).join("/")} — everything in it moves`}
        placeholder="notes/ai-governance"
        initial={folderTarget ?? (path ? path.split("/").slice(0, -1).join("/") : "")}
        onClose={() => {
          setRenamingFolder(false);
          setFolderTarget(null);
        }}
        onSubmit={async (next) => {
          setRenamingFolder(false);
          const from = folderTarget ?? path?.split("/").slice(0, -1).join("/");
          setFolderTarget(null);
          if (!from) return;
          try {
            const { moved } = await backend.renameFolder(from, next);
            await refresh();
            const here = path && moved.find((m) => m.endsWith(path.split("/").pop()!));
            if (here) await open(here);
            setStatus(`Moved ${moved.length} note${moved.length > 1 ? "s" : ""} to ${next}`);
          } catch (e) {
            setError(String(e));
          }
        }}
      />
      <Prompt
        open={moving && !!path}
        label={`Move ${path ?? ""} — links are updated`}
        placeholder="meetings, notes/governance, archive…"
        initial={path ? path.split("/").slice(0, -1).join("/") : ""}
        onClose={() => setMoving(false)}
        onSubmit={async (folder) => {
          setMoving(false);
          if (!path) return;
          const name = path.split("/").pop()!;
          const target = folder.replace(/\/+$/, "");
          try {
            const r = await backend.rename(path, target ? `${target}/${name}` : name);
            await refresh();
            await open(r.newPath);
            setStatus(`Moved to ${r.newPath}`);
          } catch (e) {
            setError(String(e));
          }
        }}
      />
      <Prompt
        open={renaming}
        label="Rename — the filename and the # heading both follow"
        placeholder="Cross-cloud networking"
        initial={titleOf(doc.content, path)}
        onClose={() => setRenaming(false)}
        onSubmit={async (next) => {
          setRenaming(false);
          if (!path) return;
          const folder = path.split("/").slice(0, -1).join("/");
          const file = slugify(next);
          if (!file) return;
          try {
            const r = await backend.rename(
              path,
              folder ? `${folder}/${file}` : file,
              next,
            );
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
