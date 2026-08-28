import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  backend,
  type FileNode,
  type SyncStatus,
  type TaskRef,
  type TaskTarget,
} from "./backend";
import { AIReview } from "./components/AIReview";
import { BacklinksPanel } from "./components/BacklinksPanel";
import { CommandPalette } from "./components/CommandPalette";
import { Editor, type EditorHandle } from "./components/Editor";
import { FileTree } from "./components/FileTree";
import { QuickAdd } from "./components/QuickAdd";
import { SyncIndicator } from "./components/SyncIndicator";
import type { Command } from "./lib/commands";
import { lineLinksTo, linkNameFor } from "./lib/wikilinks";
import type { SearchHit, SkillInfo } from "./backend";
import { wrap } from "./lib/provenance";

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
  const [palette, setPalette] = useState(false);
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
  const [run, setRun] = useState<{
    skill: SkillInfo;
    text: string;
    streaming: boolean;
    error: string | null;
  } | null>(null);
  const abort = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { files, sync } = await backend.listFiles();
      setFiles(files);
      setSync(sync);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const open = useCallback(async (p: string) => {
    try {
      const content = await backend.readFile(p);
      setDoc({ path: p, content });
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
    (withProvenance: boolean) => {
      if (!run || !editor.current) return;
      const text = withProvenance
        ? wrap(run.text, {
            model: "claude-opus-5",
            skill: run.skill.id,
            at: new Date().toISOString().slice(0, 16),
          })
        : run.text.trim();

      editor.current.apply(text, run.skill.mode);
      setRun(null);
    },
    [run],
  );

  const rejectRun = useCallback(() => {
    abort.current?.abort();
    setRun(null);
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
  // In Phase 3, skills from .sage/skills/ append to this same list.
  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      {
        id: "todo.week",
        title: "Open this week",
        keywords: "todo current",
        hint: "⌘⇧T adds",
        run: async () => open((await backend.week()).path),
      },
      {
        id: "todo.rollover",
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
        id: "view.split",
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
        id: "todo.backlog",
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
        keywords: `ai skill ${sk.context} ${sk.mode}`,
        hint: sk.context === "selection" ? "selection" : sk.context,
        run: () => runSkill(sk),
      });
      list.push({
        id: `skill-edit:${sk.id}`,
        title: `Edit skill: ${sk.title}`,
        keywords: `prompt ${sk.path}`,
        hint: sk.path,
        run: () => open(sk.path),
      });
    }

    for (const t of backlog) {
      list.push({
        id: `pull:${t.path}:${t.line}`,
        title: `Pull: ${t.text}`,
        keywords: `backlog ${t.section}`,
        hint: t.rolled ? `rolled ${t.rolled}×` : undefined,
        run: async () => {
          try {
            const week = (await backend.week()).path;
            await backend.moveTask(t.path, t.line, week);
            await open(week);
            await refresh();
            setStatus(`Pulled "${t.text}" into this week`);
          } catch (e) {
            setError(String(e));
          }
        },
      });
    }

    for (const f of flatten(files)) {
      list.push({
        id: `open:${f.path}`,
        title: `Open ${f.name.replace(/\.md$/, "")}`,
        keywords: f.path,
        hint: f.path,
        run: () => open(f.path),
      });
    }
    return list;
  }, [files, path, backlog, split, skills, open, openSplit, refresh, runSkill]);

  // ⌘K is the single invocation surface; ⌘⇧T is the one capture shortcut worth its own key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        // Refresh backlog entries so "Pull: …" reflects the file, not a stale snapshot.
        backend.backlogTasks().then(setBacklog).catch(() => setBacklog([]));
        // Skills are vault files, so re-read them rather than trusting a snapshot —
        // editing a prompt takes effect on the next palette open.
        backend
          .skills()
          .then((r) => setSkills(r.skills))
          .catch(() => setSkills([]));
        setPalette(true);
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        setQuickAdd(true);
      }
      if (mod && e.key === "\\") {
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
          ⌘K commands · ⌘⇧T add · ⌘⏎ done · ⌘\ split
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header
          className="flex h-9 shrink-0 items-center border-b px-4 text-xs"
          style={{ borderColor: "var(--sage-border)", color: "var(--sage-muted)" }}
        >
          {path ?? "No file open"}
        </header>
        {error && (
          <div className="px-4 py-2 text-xs" style={{ color: "#ef4444" }}>
            {error}
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
          <div className="min-w-0 flex-1">
            <Editor
              path={doc.path}
              content={doc.content}
              onSave={save}
              onCursor={(n) => (line.current = n)}
              files={files}
              onOpenLink={open}
            />
          </div>
          {split && (
            <div
              className="flex min-w-0 flex-1 flex-col border-l"
              style={{ borderColor: "var(--sage-border)" }}
            >
              <div
                className="flex h-7 shrink-0 items-center justify-between border-b px-3 text-[11px]"
                style={{ borderColor: "var(--sage-border)", color: "var(--sage-muted)" }}
              >
                <span className="truncate">{split.path}</span>
                <button onClick={() => setSplit(null)} className="shrink-0 px-1">
                  ✕
                </button>
              </div>
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
          onAccept={() => acceptRun(true)}
          onAcceptPlain={() => acceptRun(false)}
          onReject={rejectRun}
        />
        <BacklinksPanel hits={backlinks} onOpen={open} />
      </main>

      <QuickAdd open={quickAdd} onClose={() => setQuickAdd(false)} onSubmit={addTask} />
      <CommandPalette
        open={palette}
        commands={commands}
        onClose={() => setPalette(false)}
      />
    </div>
  );
}
