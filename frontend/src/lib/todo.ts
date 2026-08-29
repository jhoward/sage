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
const BULLET = /^(\s*)([-*])\s+(\[[ xX]\]\s?)?(.*)$/;
// Lines that are structure, not content. Turning a heading into "- [ ] ## Now" is the
// kind of helpfulness that destroys a file.
const STRUCTURAL = /^\s*(#{1,6}\s|>|```|~~~|---\s*$|\w+:\s)/;

/**
 * Enter continues a list, the way every markdown editor does.
 *
 * On a task line it opens another task; on a plain bullet, another bullet. On an *empty*
 * item it removes the marker and exits the list instead, which is what stops a stray
 * bullet being left behind every time you finish a list.
 *
 * This is why there is no separate "new task" key — the obvious gesture already works.
 */
export function continueList(view: CommandTarget): boolean {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty) return false;

  const line = state.doc.lineAt(range.head);
  // Only from the end of the line; mid-line Enter must split normally.
  if (range.head !== line.to) return false;

  const m = BULLET.exec(line.text);
  if (!m) return false;

  const [, indent, bullet, box, rest] = m;

  if (!rest.trim()) {
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: "" },
      userEvent: "input.exitList",
    });
    return true;
  }

  const prefix = `${indent}${bullet} ${box ? "[ ] " : ""}`;
  view.dispatch({
    changes: { from: range.head, insert: `\n${prefix}` },
    selection: { anchor: range.head + 1 + prefix.length },
    userEvent: "input.continueList",
    scrollIntoView: true,
  });
  return true;
}

export function toggleTask(view: CommandTarget): boolean {
  const { state } = view;
  const lines = selectedLineNumbers(state);
  const tasks = lines
    .map((n) => parseTask(state.doc.line(n)))
    .filter((t): t is TaskLine => t !== null);

  if (tasks.length) {
    // Every selected task ends in the *same* state, rather than each flipping
    // independently. Flipping is right for one line and wrong for a batch: dragging over
    // a range you have half-finished would uncheck the done ones while checking the rest,
    // which is never what was meant. If anything is unfinished, finish everything —
    // that is what selecting a batch usually means.
    const done = !tasks.some((t) => !t.done);
    const target = done ? " " : "x";

    const changes = tasks
      .filter((t) => (t.done ? "x" : " ") !== target)
      .map((t) => ({ from: t.markPos, to: t.markPos + 1, insert: target }));

    if (!changes.length) return true; // already uniform
    view.dispatch({ changes, userEvent: "input.toggleTask" });
    return true;
  }

  // Nothing selected is a task yet — make them all tasks.
  const changes = [];
  for (const n of lines) {
    const line = state.doc.line(n);
    const text = line.text.trim();
    if (!text || STRUCTURAL.test(line.text)) continue;

    const m = BULLET.exec(line.text);
    const indent = m ? m[1] : line.text.match(/^\s*/)![0];
    const body = m ? m[4] : text;
    changes.push({
      from: line.from,
      to: line.to,
      insert: `${indent}- [ ] ${body}`,
    });
  }

  if (!changes.length) return false;
  view.dispatch({ changes, userEvent: "input.makeTask" });
  return true;
}

/** Every line number the selection touches, deduplicated and in order. */
function selectedLineNumbers(state: EditorState): number[] {
  const seen = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n++) seen.add(n);
  }
  return [...seen].sort((a, b) => a - b);
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
        { key: "Enter", run: continueList },
        { key: "Mod-Enter", run: toggleTask },
        // Alt-Shift-Up rather than Mod-Shift-Up: the latter is "extend selection to the
        // start of the document" on macOS, which is worth more than a task shortcut.
        // This also pairs naturally — Alt-Up nudges one line, Alt-Shift-Up goes all the way.
        { key: "Alt-Shift-ArrowUp", run: promoteToTop },
        { key: "Alt-ArrowUp", run: moveLineUp },
        { key: "Alt-ArrowDown", run: moveLineDown },
        { key: "Mod-Shift-k", run: deleteLine },
        { key: "Mod-Shift-h", run: hideCompleted },
      ]),
    ),
  ];
}
