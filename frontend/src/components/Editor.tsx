import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, highlightActiveLine, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { todoExtension } from "../lib/todo";

const AUTOSAVE_MS = 500;

interface Props {
  path: string | null;
  content: string;
  onSave: (path: string, content: string) => void;
  /** 1-based line under the cursor, so palette commands can act on "this task". */
  onCursor?: (line: number) => void;
}

export function Editor({ path, content, onSave, onCursor }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);

  // onSave is read through a ref so the save closure never goes stale, while the *path*
  // is deliberately NOT: each editor instance saves only to the file it was opened with.
  const save = useRef(onSave);
  save.current = onSave;
  const cursor = useRef(onCursor);
  cursor.current = onCursor;

  useEffect(() => {
    if (!host.current || !path) return;

    // Captured per instance. React runs cleanup after re-rendering with the next path,
    // so reading `path` from props at flush time would write this document into the
    // *next* file — silently destroying it.
    const filePath = path;
    const loaded = content;
    let timer: number | null = null;
    let dirty = false;

    const flush = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      if (!dirty || !view.current) return;
      dirty = false;
      save.current(filePath, view.current.state.doc.toString());
    };

    const state = EditorState.create({
      doc: loaded,
      extensions: [
        history(),
        drawSelection(),
        highlightActiveLine(),
        markdown(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        EditorView.lineWrapping,
        todoExtension(),
        keymap.of([
          { key: "Mod-s", preventDefault: true, run: () => (flush(), true) },
          ...historyKeymap,
          ...defaultKeymap,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.selectionSet || u.docChanged) {
            const head = u.state.selection.main.head;
            cursor.current?.(u.state.doc.lineAt(head).number);
          }
          if (!u.docChanged) return;
          dirty = true;
          if (timer !== null) window.clearTimeout(timer);
          timer = window.setTimeout(flush, AUTOSAVE_MS);
        }),
      ],
    });

    const instance = new EditorView({ state, parent: host.current });
    view.current = instance;

    const onUnload = () => flush();
    window.addEventListener("beforeunload", onUnload);

    return () => {
      window.removeEventListener("beforeunload", onUnload);
      flush(); // pending edits land in filePath, not whatever is open next
      instance.destroy();
      if (view.current === instance) view.current = null;
    };
    // `content` is the file's loaded text and is intentionally not a dependency:
    // re-running on every keystroke would rebuild the editor. External reloads are
    // handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Adopt content that changed underneath us (e.g. quick-add appended to this file).
  useEffect(() => {
    const v = view.current;
    if (!v || v.state.doc.toString() === content) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: content } });
  }, [content]);

  if (!path) {
    return (
      <div
        className="flex h-full items-center justify-center text-sm"
        style={{ color: "var(--sage-muted)" }}
      >
        Select a note, or press ⌘⇧T to add a task
      </div>
    );
  }

  return <div ref={host} className="h-full overflow-auto" />;
}
