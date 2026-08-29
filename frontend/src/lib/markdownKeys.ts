/**
 * ⌘B and ⌘I — the two shortcuts every text editor has and this one did not.
 *
 * Wrapping rather than replacing: with a selection they surround it, without one they
 * insert the markers and place the cursor between them, which is what both keys do
 * everywhere else.
 */

import type { EditorView } from "@codemirror/view";
import type { EditorState, TransactionSpec } from "@codemirror/state";

interface Target {
  state: EditorState;
  dispatch(spec: TransactionSpec): void;
}

function wrap(view: Target, marker: string): boolean {
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

export const bold = (view: EditorView) => wrap(view, "**");
export const italic = (view: EditorView) => wrap(view, "*");
