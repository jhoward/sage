import { useCallback, useEffect, useState } from "react";
import { backend, type FileNode, type SyncStatus, type TaskTarget } from "./backend";
import { Editor } from "./components/Editor";
import { FileTree } from "./components/FileTree";
import { QuickAdd } from "./components/QuickAdd";
import { SyncIndicator } from "./components/SyncIndicator";

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
  const [error, setError] = useState<string | null>(null);

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

  const save = useCallback(async (p: string, body: string) => {
    try {
      await backend.writeFile(p, body);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  // ⌘⇧T is global: capture from anywhere, including mid-note.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        setQuickAdd(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
          <FileTree nodes={files} selected={path} onOpen={open} />
        </div>
        <div
          className="border-t px-3 py-2 text-[11px]"
          style={{ borderColor: "var(--sage-border)", color: "var(--sage-muted)" }}
        >
          ⌘⇧T add · ⌘⏎ done · ⌘⇧↑ top · ⌘⇧H hide
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
        <div className="min-h-0 flex-1">
          <Editor path={doc.path} content={doc.content} onSave={save} />
        </div>
      </main>

      <QuickAdd open={quickAdd} onClose={() => setQuickAdd(false)} onSubmit={addTask} />
    </div>
  );
}
