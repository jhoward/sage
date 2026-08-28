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
}

export function Editor({ path, content, onSave }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const timer = useRef<number | null>(null);

  // Keep the latest save target in a ref so the debounce closure never goes stale.
  const target = useRef({ path, onSave });
  target.current = { path, onSave };

  const flush = () => {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const { path: p, onSave: save } = target.current;
    if (p && view.current) save(p, view.current.state.doc.toString());
  };

  useEffect(() => {
    if (!host.current) return;

    const state = EditorState.create({
      doc: content,
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
          if (!u.docChanged) return;
          if (timer.current) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(flush, AUTOSAVE_MS);
        }),
      ],
    });

    view.current = new EditorView({ state, parent: host.current });
    return () => {
      flush(); // never lose a pending edit on unmount
      view.current?.destroy();
      view.current = null;
    };
    // Recreate only when the open file changes; content edits flow through CodeMirror.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Replace the document when the same file is reloaded from disk.
  useEffect(() => {
    const v = view.current;
    if (!v || v.state.doc.toString() === content) return;
    v.dispatch({
      changes: { from: 0, to: v.state.doc.length, insert: content },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  // Save on window close as well as on unmount.
  useEffect(() => {
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!path) {
    return (
      <div className="flex h-full items-center justify-center text-sm"
           style={{ color: "var(--sage-muted)" }}>
        Select a note, or press ⌘⇧T to add a task
      </div>
    );
  }

  return <div ref={host} className="h-full overflow-auto" />;
}
