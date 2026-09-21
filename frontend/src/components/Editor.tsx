import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorState } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  drawSelection,
  highlightActiveLine,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { indentUnit, syntaxHighlighting } from "@codemirror/language";
import { todoCommands, todoExtension } from "../lib/todo";
import { setLinkFiles, wikilinkExtension } from "../lib/wikilinkExtension";
import { livePreviewExtension } from "../lib/livePreview";
import { bold, italic } from "../lib/markdownKeys";
import { boundKeys } from "../lib/editorKeys";
import { inkHighlight } from "../lib/highlight";
import { bodyStart, frontmatterExtension } from "../lib/frontmatter";
import type { SkillMode } from "../backend";
import type { FileNode } from "../backend";

const AUTOSAVE_MS = 500;

/**
 * A config file (TOML, in practice): no markdown, and its comments quietened so the few
 * lines that are settings stand out from the many that explain them.
 */
const commentLine = Decoration.line({ class: "cm-config-comment" });
const plainConfig = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
    }
    build(view: EditorView) {
      const lines = [];
      for (const { from, to } of view.visibleRanges) {
        for (let pos = from; pos <= to; ) {
          const line = view.state.doc.lineAt(pos);
          if (/^\s*#/.test(line.text)) lines.push(commentLine.range(line.from));
          pos = line.to + 1;
        }
      }
      return Decoration.set(lines);
    }
  },
  { decorations: (v) => v.decorations },
);

interface Props {
  path: string | null;
  content: string;
  onSave: (path: string, content: string) => void;
  /** 1-based line under the cursor, so palette commands can act on "this task". */
  onCursor?: (line: number) => void;
  /** Vault tree, for resolving [[links]]. */
  files?: FileNode[];
  /** Cmd-click on a resolving [[link]]. */
  onOpenLink?: (path: string) => void;
  /** Cmd-click on an unresolved [[link]] — create that note. */
  onCreateLink?: (name: string) => void;
}

export interface EditorHandle {
  selection(): string;
  /** Apply generated text. `replace` swaps the selection, or the whole doc if none. */
  apply(text: string, mode: SkillMode): void;
  /** Run an editor command on the line under the cursor, as its key would. */
  run(command: keyof typeof todoCommands): void;
}

export const Editor = forwardRef<EditorHandle, Props>(function Editor(
  { path, content, onSave, onCursor, files, onOpenLink, onCreateLink },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const filesRef = useRef<FileNode[]>(files ?? []);
  // Where you were in each note. Reopening at the top of a long note loses your place for
  // no reason; the browser does this for pages and an editor should for documents.
  const scrollTops = useRef<Map<string, number>>(new Map());

  // onSave is read through a ref so the save closure never goes stale, while the *path*
  // is deliberately NOT: each editor instance saves only to the file it was opened with.
  const save = useRef(onSave);
  save.current = onSave;
  const cursor = useRef(onCursor);
  cursor.current = onCursor;
  const openLink = useRef(onOpenLink);
  openLink.current = onOpenLink;
  const createLink = useRef(onCreateLink);
  createLink.current = onCreateLink;

  useEffect(() => {
    if (!host.current || !path) return;

    // Captured per instance. React runs cleanup after re-rendering with the next path,
    // so reading `path` from props at flush time would write this document into the
    // *next* file — silently destroying it.
    const filePath = path;
    const loaded = content;
    const isMarkdown = /\.(md|markdown)$/i.test(filePath);
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
        ...(isMarkdown
          ? [
              // GFM rather than plain CommonMark: without it ~~strikethrough~~ and tables
              // do not parse at all, so nothing downstream can render them.
              markdown({ base: markdownLanguage }),
              syntaxHighlighting(inkHighlight),
            ]
          : [plainConfig]),
        EditorView.lineWrapping,
        // Two spaces per level, which is what the cheat sheet documents and what markdown
        // list nesting conventionally uses.
        indentUnit.of("  "),
        // ⌘F, ⌘G, ⇧⌘G — find within the open note. Keeping the platform's own bindings
        // where they exist means less to learn: ⌘⇧F searches the vault, ⌘F searches here,
        // which is what both keys already mean everywhere else on the system.
        search({ top: true }),
        highlightSelectionMatches(),
        // Everything that reads the text as markdown is for markdown. A settings file
        // opened with these on is a wall of headings: live preview takes each
        // `# comment` for an H1 and hides the `#`.
        ...(isMarkdown
          ? [
              todoExtension(),
              wikilinkExtension(
                (p) => openLink.current?.(p),
                (name) => createLink.current?.(name),
              ),
              livePreviewExtension(),
              frontmatterExtension,
              boundKeys({ bold, italic }),
            ]
          : []),
        keymap.of([
          { key: "Mod-s", preventDefault: true, run: () => (flush(), true) },
          ...searchKeymap,
          ...historyKeymap,
          // Without CodeMirror's ⌘[ / ⌘] indent: Tab and Shift-Tab are the indent keys
          // here, and those two belong to back/forward. Left in, they would come back
          // to life the moment back/forward were rebound to something else.
          ...defaultKeymap.filter((b) => b.key !== "Mod-[" && b.key !== "Mod-]"),
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
    // A new editor's cursor is at offset 0, which is inside the frontmatter — and a cursor
    // in the frontmatter is what reveals it raw. Start in the note itself instead, which
    // is also where anyone would want to start typing.
    if (isMarkdown) instance.dispatch({ selection: { anchor: bodyStart(instance.state) } });

    const remembered = scrollTops.current.get(filePath);
    if (remembered) instance.scrollDOM.scrollTop = remembered;
    const onScroll = () => scrollTops.current.set(filePath, instance.scrollDOM.scrollTop);
    instance.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
    instance.dispatch({ effects: setLinkFiles.of(filesRef.current) });

    const onUnload = () => flush();
    window.addEventListener("beforeunload", onUnload);

    return () => {
      window.removeEventListener("beforeunload", onUnload);
      instance.scrollDOM.removeEventListener("scroll", onScroll);
      flush(); // pending edits land in filePath, not whatever is open next
      instance.destroy();
      if (view.current === instance) view.current = null;
    };
    // `content` is the file's loaded text and is intentionally not a dependency:
    // re-running on every keystroke would rebuild the editor. External reloads are
    // handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useImperativeHandle(
    ref,
    () => ({
      selection() {
        const v = view.current;
        if (!v) return "";
        const { from, to } = v.state.selection.main;
        return from === to ? "" : v.state.sliceDoc(from, to);
      },
      apply(text, mode) {
        const v = view.current;
        if (!v) return;
        const { from, to } = v.state.selection.main;
        const doc = v.state.doc;

        // Each mode maps to exactly one document edit, so undo reverses it in one step.
        const change =
          mode === "append"
            ? { from: doc.length, to: doc.length, insert: `\n\n${text}\n` }
            : mode === "insert"
              ? { from: to, to, insert: text }
              : from === to
                ? { from: 0, to: doc.length, insert: text }
                : { from, to, insert: text };

        v.dispatch({ changes: change, userEvent: "input.ai", scrollIntoView: true });
        v.focus();
      },
      run(command) {
        const v = view.current;
        if (!v) return;
        todoCommands[command](v);
        v.focus();
      },
    }),
    [],
  );

  // Keep link resolution current as notes are created or renamed.
  useEffect(() => {
    filesRef.current = files ?? [];
    view.current?.dispatch({ effects: setLinkFiles.of(files ?? []) });
  }, [files]);

  // Adopt content that changed underneath us (e.g. quick-add appended to this file).
  useEffect(() => {
    const v = view.current;
    if (!v || v.state.doc.toString() === content) return;
    // Keep the cursor where it was. Replacing the whole document maps it to offset 0,
    // which loses your place and lands inside the frontmatter, flipping it to raw.
    const head = Math.min(v.state.selection.main.head, content.length);
    v.dispatch({
      changes: { from: 0, to: v.state.doc.length, insert: content },
      selection: { anchor: head },
    });
  }, [content]);

  if (!path) {
    return (
      <div
        className="flex h-full items-center justify-center text-sm"
        style={{ color: "var(--ink-muted)" }}
      >
        Select a note, or press ⌘⇧T to add a task
      </div>
    );
  }

  return <div ref={host} className="h-full overflow-auto" />;
});
