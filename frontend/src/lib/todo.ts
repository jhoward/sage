/**
 * Todo interactions as a CodeMirror extension over ordinary markdown.
 *
 * There is no task database, no index, and no separate todo view — the file on disk is
 * the only representation, so nothing can drift out of sync with it. This is the whole
 * todo system: decorations plus a handful of commands.
 *
 * One rule worth preserving: hide-completed is a *view* filter. Completed tasks stay in
 * the file because they are the raw material for weekly summaries; they just leave the
 * active view so the week still fits on one screen.
 */

import {
  Decoration,
  EditorView,
  ViewPlugin,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import {
  StateEffect,
  StateField,
  Prec,
  RangeSetBuilder,
  type EditorState,
  type Line,
  type TransactionSpec,
} from "@codemirror/state";
import { deleteLine, moveLineDown, moveLineUp } from "@codemirror/commands";

const TASK = /^(\s*[-*]\s+\[)([ xX])(\]\s?)(.*)$/;
const HEADING = /^#{1,6}\s/;

export interface TaskLine {
  line: Line;
  done: boolean;
  /** Document offset of the character inside the brackets. */
  markPos: number;
  text: string;
}

export function parseTask(line: Line): TaskLine | null {
  const m = TASK.exec(line.text);
  if (!m) return null;
  return {
    line,
    done: m[2] !== " ",
    markPos: line.from + m[1].length,
    text: m[4],
  };
}

// ---- hide completed (view-only) --------------------------------------

export const toggleHideCompleted = StateEffect.define<void>();

export const hideCompletedField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(toggleHideCompleted)) return !value;
    return value;
  },
});

const doneLine = Decoration.line({ class: "cm-task-done" });
const hiddenLine = Decoration.line({ attributes: { style: "display:none" } });

function buildDecorations(view: EditorView): DecorationSet {
  const hide = view.state.field(hideCompletedField, false) ?? false;
  const builder = new RangeSetBuilder<Decoration>();

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      const task = parseTask(line);
      if (task?.done) {
        builder.add(line.from, line.from, hide ? hiddenLine : doneLine);
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

const taskDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.startState.field(hideCompletedField, false) !== u.state.field(hideCompletedField, false)) {
        this.decorations = buildDecorations(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

// ---- commands --------------------------------------------------------

/**
 * The minimum a command needs. EditorView satisfies this structurally, so the commands
 * drop straight into a keymap — while tests can drive them with a plain object and no DOM.
 */
export interface CommandTarget {
  state: EditorState;
  dispatch(spec: TransactionSpec): void;
}

/** Flip `- [ ]` to `- [x]` and back. The single most frequent action, so: one key. */
export function toggleTask(view: CommandTarget): boolean {
  const changes = [];
  const seen = new Set<number>();

  for (const range of view.state.selection.ranges) {
    const first = view.state.doc.lineAt(range.from).number;
    const last = view.state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      const task = parseTask(view.state.doc.line(n));
      if (task) {
        changes.push({
          from: task.markPos,
          to: task.markPos + 1,
          insert: task.done ? " " : "x",
        });
      }
    }
  }

  if (!changes.length) return false;
  view.dispatch({ changes, userEvent: "input.toggleTask" });
  return true;
}

/**
 * Move the current line to the top of its section.
 *
 * Precise positioning is a made-up requirement — the real moves are "to the top" and
 * "to another bucket". This is the first one, in a single keystroke.
 */
export function promoteToTop(view: CommandTarget): boolean {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);

  // Nearest preceding heading; the line lands directly beneath it.
  let insertAfter = 0;
  for (let n = line.number - 1; n >= 1; n--) {
    if (HEADING.test(state.doc.line(n).text)) {
      insertAfter = n;
      break;
    }
  }
  if (insertAfter === line.number - 1) return false; // already at the top

  const target = state.doc.line(insertAfter + 1);
  const text = line.text;
  const cut = { from: line.from, to: Math.min(line.to + 1, state.doc.length) };

  view.dispatch({
    changes: [cut, { from: target.from, insert: text + "\n" }],
    selection: { anchor: target.from + text.length },
    userEvent: "move.promote",
    scrollIntoView: true,
  });
  return true;
}

export function hideCompleted(view: CommandTarget): boolean {
  view.dispatch({ effects: toggleHideCompleted.of() });
  return true;
}

// ---- checkbox clicking -----------------------------------------------

const clickCheckbox = EditorView.domEventHandlers({
  mousedown(event, view) {
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) return false;

    const task = parseTask(view.state.doc.lineAt(pos));
    if (!task) return false;
    // Only the two characters spanning "[x]" count as the checkbox.
    if (pos < task.markPos - 1 || pos > task.markPos + 1) return false;

    view.dispatch({
      changes: {
        from: task.markPos,
        to: task.markPos + 1,
        insert: task.done ? " " : "x",
      },
      userEvent: "input.toggleTask",
    });
    event.preventDefault();
    return true;
  },
});

// ---- assembly --------------------------------------------------------

export function todoExtension() {
  return [
    hideCompletedField,
    taskDecorations,
    clickCheckbox,
    // High precedence so these beat the default markdown/editor bindings.
    Prec.high(
      keymap.of([
        { key: "Mod-Enter", run: toggleTask },
        { key: "Mod-Shift-ArrowUp", run: promoteToTop },
        { key: "Alt-ArrowUp", run: moveLineUp },
        { key: "Alt-ArrowDown", run: moveLineDown },
        { key: "Mod-Shift-k", run: deleteLine },
        { key: "Mod-Shift-h", run: hideCompleted },
      ]),
    ),
  ];
}
