/**
 * ⌘B and ⌘I — the two shortcuts every text editor has and this one did not.
 *
 * Wrapping rather than replacing: with a selection they surround it, without one they
 * insert the markers and place the cursor between them, which is what both keys do
 * everywhere else.
 *
 * Across several lines they wrap each line separately, and inside its list marker. This is
 * not a style preference — markdown emphasis cannot cross a block boundary, so a single
 * pair of `**` around four list items parses as a paragraph followed by an unrelated list,
 * and renders as literal asterisks in every renderer there is. The first version did
 * exactly that and produced markdown that could not be displayed.
 */

import type { EditorView } from "@codemirror/view";
import type { ChangeSpec, EditorState, TransactionSpec } from "@codemirror/state";

interface Target {
  state: EditorState;
  dispatch(spec: TransactionSpec): void;
}

/**
 * Leading structure that emphasis must sit inside rather than swallow: list markers,
 * task checkboxes, ordered markers, quote markers, heading hashes.
 */
const PREFIX = /^(\s*(?:(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?|>\s*|#{1,6}\s+)?)(.*?)(\s*)$/;

function wrapSingle(view: Target, marker: string): boolean {
  const { state } = view;
  const range = state.selection.main;
  const n = marker.length;

  const before = state.sliceDoc(Math.max(0, range.from - n), range.from);
  const after = state.sliceDoc(range.to, Math.min(state.doc.length, range.to + n));

  // Already wrapped: unwrap, so the same key toggles rather than nesting markers.
  if (before === marker && after === marker) {
    view.dispatch({
      changes: [
        { from: range.from - n, to: range.from },
        { from: range.to, to: range.to + n },
      ],
      selection: { anchor: range.from - n, head: range.to - n },
      userEvent: "input.unwrap",
    });
    return true;
  }

  view.dispatch({
    changes: [
      { from: range.from, insert: marker },
      { from: range.to, insert: marker },
    ],
    selection: range.empty
      ? { anchor: range.from + n }
      : { anchor: range.from + n, head: range.to + n },
    userEvent: "input.wrap",
  });
  return true;
}

/** The content span of a line, excluding any list/quote/heading prefix and trailing space. */
function content(state: EditorState, lineNo: number) {
  const line = state.doc.line(lineNo);
  const m = PREFIX.exec(line.text);
  if (!m || !m[2]) return null;
  return { from: line.from + m[1].length, to: line.from + m[1].length + m[2].length };
}

function wrapEach(view: Target, marker: string, first: number, last: number): boolean {
  const { state } = view;
  const spans = [];
  for (let n = first; n <= last; n++) {
    const span = content(state, n);
    if (span) spans.push(span);
  }
  if (!spans.length) return true;

  const wrapped = (s: { from: number; to: number }) =>
    s.to - s.from >= marker.length * 2 &&
    state.sliceDoc(s.from, s.from + marker.length) === marker &&
    state.sliceDoc(s.to - marker.length, s.to) === marker;

  // Toggle off only when every line is already wrapped; a mixed selection means the
  // intent was to make all of it bold, not to strip the parts that already were.
  const changes: ChangeSpec[] = [];
  if (spans.every(wrapped)) {
    for (const s of spans) {
      changes.push({ from: s.from, to: s.from + marker.length });
      changes.push({ from: s.to - marker.length, to: s.to });
    }
  } else {
    for (const s of spans) {
      if (wrapped(s)) continue;
      changes.push({ from: s.from, insert: marker });
      changes.push({ from: s.to, insert: marker });
    }
  }

  // No explicit selection: it is given in coordinates of the *new* document, and the
  // markers being inserted shift every position after the first one. Letting CodeMirror
  // map the existing selection through the changes keeps the same lines covered.
  view.dispatch({ changes, userEvent: "input.wrap" });
  return true;
}

function wrap(view: Target, marker: string): boolean {
  const { state } = view;
  const range = state.selection.main;
  const first = state.doc.lineAt(range.from).number;
  const last = state.doc.lineAt(range.to).number;
  return first === last
    ? wrapSingle(view, marker)
    : wrapEach(view, marker, first, last);
}

export const bold = (view: EditorView) => wrap(view, "**");
export const italic = (view: EditorView) => wrap(view, "*");
