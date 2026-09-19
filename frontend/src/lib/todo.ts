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
  WidgetType,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import {
  StateEffect,
  StateField,
  Prec,
  type ChangeSpec,
  type EditorState,
  type Line,
  Transaction,
  type Range,
  type TransactionSpec,
} from "@codemirror/state";
import {
  indentLess,
  indentMore,
  moveLineDown,
  moveLineUp,
} from "@codemirror/commands";
import { boundKeys, type EditorCommand } from "./editorKeys";
import type { BindingName } from "./keybindings";

// A numbered item is a task too: `1. [ ] foo` is valid GitHub-flavoured markdown, and a
// list you numbered is the one you are most likely to want to tick off in order.
const TASK = /^(\s*(?:[-*]|\d+[.)])\s+\[)([ xX])(\]\s?)(.*)$/;
const HEADING = /^#{1,6}\s/;

export interface TaskLine {
  line: Line;
  done: boolean;
  /** Document offset of the character inside the brackets. */
  markPos: number;
  text: string;
  /**
   * What the drawn checkbox stands in for. A `-` goes with its box, since a bullet beside
   * a checkbox is noise; a number stays, since it is the one thing the box cannot say.
   */
  boxFrom: number;
  boxTo: number;
}

export function parseTask(line: Line): TaskLine | null {
  const m = TASK.exec(line.text);
  if (!m) return null;
  const markPos = line.from + m[1].length;
  const indent = m[1].length - m[1].trimStart().length;
  const ordered = /\d/.test(m[1][indent]);
  return {
    line,
    done: m[2] !== " ",
    markPos,
    text: m[4],
    boxFrom: ordered ? markPos - 1 : line.from + indent,
    boxTo: markPos + 2,
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

/**
 * The checkbox, drawn.
 *
 * Literal `[ ]` gave no hint that it could be clicked, and the target was three characters
 * wide. Same rule as every other piece of live preview: the raw markdown comes back when
 * the cursor is on it, so this is still not a mode.
 */
class CheckboxWidget extends WidgetType {
  readonly done: boolean;
  constructor(done: boolean) {
    super();
    this.done = done;
  }
  eq(other: CheckboxWidget) {
    return other.done === this.done;
  }
  toDOM() {
    const box = document.createElement("span");
    box.className = "cm-task-checkbox";
    box.setAttribute("role", "checkbox");
    box.setAttribute("aria-checked", String(this.done));
    // The tick is drawn in CSS, not typed in. A box with text in it aligns by that text's
    // baseline and an empty one by its bottom edge, so a "✓" made done boxes sit lower.
    return box;
  }
  // Widgets swallow events by default, which would make the box unclickable.
  ignoreEvent() {
    return false;
  }
}

const boxes = {
  open: Decoration.replace({ widget: new CheckboxWidget(false) }),
  done: Decoration.replace({ widget: new CheckboxWidget(true) }),
};

interface Built {
  all: DecorationSet;
  /** The drawn boxes alone, so the cursor steps over one rather than into it. */
  atomic: DecorationSet;
}

function buildDecorations(view: EditorView): Built {
  const { state } = view;
  const hide = state.field(hideCompletedField, false) ?? false;
  const all: Range<Decoration>[] = [];
  const atomic: Range<Decoration>[] = [];

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;

      const task = parseTask(line);
      if (!task) continue;
      if (task.done && hide) {
        all.push(hiddenLine.range(line.from));
        continue;
      }
      if (task.done) all.push(doneLine.range(line.from));

      const editing = state.selection.ranges.some(
        (r) => r.to >= task.boxFrom && r.from <= task.boxTo,
      );
      if (!editing) {
        const box = (task.done ? boxes.done : boxes.open).range(task.boxFrom, task.boxTo);
        all.push(box);
        atomic.push(box);
      }
    }
  }
  return { all: Decoration.set(all, true), atomic: Decoration.set(atomic, true) };
}

const taskDecorations = ViewPlugin.fromClass(
  class {
    built: Built;
    constructor(view: EditorView) {
      this.built = buildDecorations(view);
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.selectionSet ||
        u.startState.field(hideCompletedField, false) !== u.state.field(hideCompletedField, false)
      ) {
        this.built = buildDecorations(u.view);
      }
    }
  },
  {
    decorations: (v) => v.built.all,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.built.atomic ?? Decoration.none),
  },
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

// indent, marker, gap, checkbox, rest. The marker is a bullet or a number.
const BULLET = /^(\s*)([-*]|\d+[.)])(\s+)(\[[ xX]\]\s?)?(.*)$/;
const NUMBER = /^(\d+)([.)])$/;
// Lines that are structure, not content. Turning a heading into "- [ ] ## Now" is the
// kind of helpfulness that destroys a file.
const STRUCTURAL = /^\s*(#{1,6}\s|>|```|~~~|---\s*$|\w+:\s)/;

/**
 * Number edits that put the list around `lineNumber` back in order.
 *
 * Markdown renders a list in order whatever the digits say, so this is for the person
 * reading the file rather than the renderer: after an item is inserted, indented or
 * outdented, the numbers on screen should still count.
 *
 * A nested list starts from 1, because an item that has just been indented arrives
 * carrying its old number. The outermost list keeps whatever it started at — a list
 * that begins at 4 on purpose is not ours to correct.
 */
function renumberChanges(
  state: EditorState,
  lineNumber: number,
  /** Overrides where the outermost list starts — see `listStart`. */
  start: number | null = null,
): ChangeSpec[] {
  const { doc } = state;
  const inList = (n: number) => {
    const text = doc.line(n).text;
    return BULLET.test(text) || /^\s+\S/.test(text); // an item, or its continuation
  };
  if (lineNumber < 1 || lineNumber > doc.lines) return [];
  if (!BULLET.test(doc.line(lineNumber).text)) return [];

  let first = lineNumber;
  while (first > 1 && inList(first - 1)) first -= 1;
  let last = lineNumber;
  while (last < doc.lines && inList(last + 1)) last += 1;

  const changes: ChangeSpec[] = [];
  const stack: Array<{ indent: number; next: number | null; outermost: boolean }> = [];

  for (let n = first; n <= last; n++) {
    const line = doc.line(n);
    const m = BULLET.exec(line.text);
    if (!m) continue;

    const indent = m[1].length;
    while (stack.length && stack[stack.length - 1].indent > indent) stack.pop();
    if (!stack.length || stack[stack.length - 1].indent < indent) {
      stack.push({ indent, next: null, outermost: stack.length === 0 });
    }
    const level = stack[stack.length - 1];

    const num = NUMBER.exec(m[2]);
    if (!num) {
      // A bullet ends the numbered run at this level; the next number starts a new list.
      level.next = null;
      level.outermost = false;
      continue;
    }

    const current = Number(num[1]);
    if (level.next === null) level.next = level.outermost ? (start ?? current) : 1;
    if (current !== level.next) {
      const from = line.from + indent;
      changes.push({ from, to: from + num[1].length, insert: String(level.next) });
    }
    level.next += 1;
  }
  return changes;
}

/**
 * The number the list around `lineNumber` starts at, or null if it is not numbered.
 *
 * Needed when an edit can change which item comes first. "Keep whatever the list starts
 * at" is right after Enter, and wrong after deleting item 1 or moving item 2 above it —
 * the list would then start at 2. Reading the start *before* the edit gives the edit
 * something to restore.
 */
function listStart(state: EditorState, lineNumber: number): number | null {
  const { doc } = state;
  let first = lineNumber;
  while (first > 1 && (BULLET.test(doc.line(first - 1).text) || /^\s+\S/.test(doc.line(first - 1).text))) {
    first -= 1;
  }
  const m = BULLET.exec(doc.line(first).text);
  const num = m && NUMBER.exec(m[2]);
  return num ? Number(num[1]) : null;
}

/**
 * Wrap a line command — move, delete — so the numbers still count afterwards.
 *
 * CodeMirror's own commands know nothing about lists: nudging item 3 above item 2 leaves
 * "3." sitting over "2.", and deleting an item leaves a gap. The command runs against a
 * stand-in whose dispatch folds the renumbering into the same transaction, so it is still
 * one undo.
 */
function renumbering(
  command: (target: {
    state: EditorState;
    dispatch: (edit: Transaction | TransactionSpec) => void;
  }) => boolean,
) {
  return (view: CommandTarget): boolean => {
    const before = view.state;
    const was = before.doc.lineAt(before.selection.main.head).number;
    const start = listStart(before, was);

    return command({
      state: before,
      dispatch(edit) {
        // CodeMirror's state commands hand over a transaction; ours hand over a spec.
        const tr = edit instanceof Transaction ? edit : before.update(edit);
        const after = tr.state;
        const now = after.doc.lineAt(after.selection.main.head).number;
        // The list the line left and the one it arrived in are usually the same list,
        // so edits are keyed by position to keep a number from being fixed twice.
        const fixes = new Map<number, ChangeSpec>();
        for (const n of [was, was + 1, now]) {
          for (const c of renumberChanges(after, n, start)) {
            fixes.set((c as { from: number }).from, c);
          }
        }
        if (!fixes.size) return view.dispatch(edit as TransactionSpec);

        const fix = after.changes([...fixes.values()]);
        view.dispatch({
          changes: tr.changes.compose(fix),
          selection: after.selection.map(fix),
          scrollIntoView: true,
          userEvent: tr.annotation(Transaction.userEvent),
        });
      },
    });
  };
}

/**
 * Apply an edit and renumber the list it touched, as one transaction — so a single undo
 * takes back both, rather than leaving the list half-corrected.
 */
function dispatchRenumbered(
  view: CommandTarget,
  spec: TransactionSpec,
  lineNumber: (state: EditorState) => number,
): void {
  const tr = view.state.update(spec);
  const fixes = renumberChanges(tr.state, lineNumber(tr.state));
  if (!fixes.length) return view.dispatch(spec);

  const fix = tr.state.changes(fixes);
  view.dispatch({
    ...spec,
    changes: tr.changes.compose(fix),
    selection: tr.state.selection.map(fix),
  });
}

/**
 * Enter continues a list, the way every markdown editor does.
 *
 * On a task line it opens another task; on a plain bullet, another bullet; in a numbered
 * list, the next number — with a box if the line above had one. On an *empty* item it
 * removes the marker and exits the list instead, which is what stops a stray bullet being
 * left behind every time you finish a list.
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

  const [, indent, marker, , box, rest] = m;

  if (!rest.trim()) {
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: "" },
      userEvent: "input.exitList",
    });
    return true;
  }

  const num = NUMBER.exec(marker);
  const next = num ? `${Number(num[1]) + 1}${num[2]}` : marker;
  const prefix = `${indent}${next} ${box ? "[ ] " : ""}`;
  dispatchRenumbered(
    view,
    {
      changes: { from: range.head, insert: `\n${prefix}` },
      selection: { anchor: range.head + 1 + prefix.length },
      userEvent: "input.continueList",
      scrollIntoView: true,
    },
    (after) => after.doc.lineAt(after.selection.main.head).number,
  );
  return true;
}

/** Flip `- [ ]` to `- [x]` and back. The single most frequent action, so: one key. */
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

    // An existing marker is kept: item 3 of a numbered list becomes `3. [ ]`, not a
    // bullet with a number stranded inside it.
    const m = BULLET.exec(line.text);
    const indent = m ? m[1] : line.text.match(/^\s*/)![0];
    const marker = m ? m[2] : "-";
    const body = m ? m[5] : text;
    changes.push({
      from: line.from,
      to: line.to,
      insert: `${indent}${marker} [ ] ${body}`,
    });
  }

  if (!changes.length) return false;
  view.dispatch({ changes, userEvent: "input.makeTask" });
  return true;
}

/**
 * Turn a task back into an ordinary line — the shifted ⌘⏎, as ⇧⇥ is the shifted ⇥.
 *
 * Only the box goes. The bullet or number stays, because the line is usually still part
 * of a list and stripping the marker would break the list around it.
 */
export function untask(view: CommandTarget): boolean {
  const { state } = view;
  const changes = [];
  for (const n of selectedLineNumbers(state)) {
    const line = state.doc.line(n);
    const m = TASK.exec(line.text);
    if (!m) continue;
    const from = line.from + m[1].length - 1;
    changes.push({ from, to: from + 1 + m[2].length + m[3].length, insert: "" });
  }

  if (!changes.length) return false;
  view.dispatch({ changes, userEvent: "input.untask" });
  return true;
}

/**
 * Every line the selection covers, deduplicated and in order.
 *
 * A selection ending at column 0 does not include that line: shift-selecting three tasks
 * leaves the cursor at the start of the fourth, with nothing on it selected, and acting on
 * it too is not what was asked for. The same rule ⌘B follows, and every line-wise editor.
 */
function selectedLineNumbers(state: EditorState): number[] {
  const seen = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const reached = state.doc.lineAt(range.to).number;
    const last =
      reached > first && range.to === state.doc.line(reached).from ? reached - 1 : reached;
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

/**
 * Tab indents a list item, Shift-Tab outdents.
 *
 * The universal convention in anything list-shaped — Obsidian, Notion, Bear, Apple Notes.
 * It coexists with ⌘[ / ⌘] for back/forward because they are different jobs: Tab is the
 * text-editor gesture for structure, ⌘[ is the platform gesture for navigation.
 *
 * An item nests under the one above it, which fixes how far it moves: to where that
 * item's text starts. Two spaces is right under a `- ` and wrong under a `4. ` — there
 * the item stays a sibling in every renderer, however indented it looks. Its children
 * move with it, and the numbers on both levels are put back in order: markdown has no
 * `4.1`, so the first item under 4 is `1.`, and the old 6 becomes the new 5.
 *
 * Outside a list Tab inserts indentation as usual. Capturing Tab does cost keyboard focus
 * traversal, which is the accepted trade in every editor that does this; Escape then Tab
 * still moves focus out.
 */
function shiftItems(view: CommandTarget, dir: 1 | -1): boolean | null {
  const { state } = view;
  const { doc } = state;
  const selected = selectedLineNumbers(state);
  const item = BULLET.exec(doc.line(selected[0]).text);
  if (!item) return null; // not a list; the caller falls back to plain indentation

  const indent = item[1].length;
  const widthOf = (n: number) => doc.line(n).text.match(/^\s*/)![0].length;

  // Walk up to the item this one relates to: the sibling it would nest under, or the
  // parent it would leave.
  let target: number | null = null;
  for (let n = selected[0] - 1; n >= 1; n--) {
    const text = doc.line(n).text;
    if (!text.trim()) break;
    const m = BULLET.exec(text);
    if (!m) {
      if (/^\s/.test(text)) continue; // a continuation line of some item above
      break;
    }
    if (dir === 1) {
      if (m[1].length > indent) continue; // the sibling's own children
      if (m[1].length === indent) target = indent + m[2].length + m[3].length;
      break; // shallower means this is already a first child, with nothing to nest under
    }
    if (m[1].length < indent) {
      target = m[1].length;
      break;
    }
  }
  if (dir === -1 && target === null) target = 0;
  // Nothing above to nest under, so there is no column to aim for: indent plainly, as Tab
  // always has here, rather than have the key appear to do nothing.
  if (target === null) return null;
  if (target === indent) return true;

  const delta = target - indent;
  const moving = new Set<number>();
  for (const n of selected) {
    if (!doc.line(n).text.trim()) continue;
    moving.add(n);
    if (!BULLET.test(doc.line(n).text)) continue;
    for (let c = n + 1; c <= doc.lines; c++) {
      if (!doc.line(c).text.trim() || widthOf(c) <= widthOf(n)) break;
      moving.add(c);
    }
  }

  const changes = [...moving].map((n) => {
    const line = doc.line(n);
    return delta > 0
      ? { from: line.from, insert: " ".repeat(delta) }
      : { from: line.from, to: line.from + Math.min(-delta, widthOf(n)), insert: "" };
  });

  dispatchRenumbered(
    view,
    { changes, userEvent: dir === 1 ? "input.indent" : "delete.dedent" },
    () => selected[0], // line numbers do not change; only columns do
  );
  return true;
}

export function indentListItem(view: CommandTarget): boolean {
  return shiftItems(view, 1) ?? indentMore(view as never);
}

export function outdentListItem(view: CommandTarget): boolean {
  return shiftItems(view, -1) ?? indentLess(view as never);
}

export function hideCompleted(view: CommandTarget): boolean {
  view.dispatch({ effects: toggleHideCompleted.of() });
  return true;
}

// ---- checkbox clicking -----------------------------------------------

const clickCheckbox = EditorView.domEventHandlers({
  mousedown(event, view) {
    // The drawn box is found by element, since a replaced range has no text to hit.
    const box = (event.target as HTMLElement | null)?.closest?.(".cm-task-checkbox");
    const pos = box
      ? view.posAtDOM(box)
      : view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) return false;

    const task = parseTask(view.state.doc.lineAt(pos));
    if (!task) return false;
    // In raw text, only the two characters spanning "[x]" count as the checkbox.
    if (!box && (pos < task.markPos - 1 || pos > task.markPos + 1)) return false;

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

/**
 * Delete the selected lines.
 *
 * CodeMirror has a `deleteLine`, but it steers the cursor by pixel geometry and so needs
 * a laid-out view, which rules out folding the renumbering into it. This does the same
 * job from the document alone: the lines go, and the cursor keeps its column on whichever
 * line moves up to take their place.
 */
export function deleteLines(view: CommandTarget): boolean {
  const { state } = view;
  const { doc } = state;
  const lines = selectedLineNumbers(state);
  const first = doc.line(lines[0]);
  const last = doc.line(lines[lines.length - 1]);

  // Take the newline after the block, or the one before it when the block ends the file.
  let from = first.from;
  let to = last.to;
  if (to < doc.length) to += 1;
  else if (from > 0) from -= 1;

  const head = state.selection.main.head;
  const column = head - doc.lineAt(head).from;
  const changes = { from, to, insert: "" };
  const landing = state.update({ changes }).state.doc.lineAt(Math.min(first.from, doc.length - (to - from)));

  view.dispatch({
    changes,
    selection: { anchor: Math.min(landing.from + column, landing.to) },
    userEvent: "delete.line",
    scrollIntoView: true,
  });
  return true;
}

/**
 * The rebindable commands, by binding name. One record serves both the keys and the
 * palette, so a command cannot be reachable from one and missing from the other.
 */
export const todoCommands = {
  toggleTask,
  untask,
  promote: renumbering(promoteToTop),
  lineUp: renumbering(moveLineUp),
  lineDown: renumbering(moveLineDown),
  deleteLine: renumbering(deleteLines),
  hideDone: hideCompleted,
} satisfies Partial<Record<BindingName, EditorCommand>>;

export function todoExtension() {
  return [
    hideCompletedField,
    taskDecorations,
    clickCheckbox,
    // Rebindable commands go through the shared key table, which is what puts them in
    // the palette, the key sheet and the keybindings file.
    boundKeys(todoCommands),
    // Enter and Tab are the text layer's own gestures, not shortcuts, and stay fixed.
    Prec.high(
      keymap.of([
        { key: "Enter", run: continueList },
        { key: "Tab", run: indentListItem },
        { key: "Shift-Tab", run: outdentListItem },
      ]),
    ),
  ];
}
