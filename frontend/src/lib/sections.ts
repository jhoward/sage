/**
 * Collapsible sections: a `## Heading` folds the lines beneath it.
 *
 * A list file holds its Archive in the same document as its Now, and the Archive is the
 * part that grows. Folding is how a single file stays a single file and still fits on a
 * screen: CodeMirror's fold machinery replaces a range with a placeholder, the text is
 * untouched, and nothing about the file changes. The Archive of a list starts folded;
 * every other section starts open; and that is the whole rule — no memory of what was
 * folded, because a rule you can predict beats a state you have to reason about, and the
 * one section that matters is a click away.
 *
 * The toggle is a chevron before the heading text, standing where the hidden `##` marker
 * is, the way a toggle heading works in an outliner. It needs no margin of its own. With
 * the cursor on the line the raw `##` comes back and the chevron steps aside — the same
 * rule as every other piece of live preview. The placeholder says how many tasks are
 * under a folded heading, so a folded Archive still answers "how much is in there".
 */

import {
  codeFolding,
  foldEffect,
  foldKeymap,
  foldedRanges,
  foldService,
  unfoldEffect,
} from "@codemirror/language";
import { EditorState, type Extension, type Range, type StateEffect } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

// Any heading ends a section; only `##` and deeper fold. A `#` is the note's title, and
// folding the whole note under its title is not a thing anyone wants.
const HEADING = /^(#{1,6})\s+\S/;
const FOLDABLE = /^(#{2,6})\s+\S/;
const TASK = /^\s*(?:[-*]|\d+[.)])\s+\[[ xX]\]/;

/**
 * What folds under the heading on `lineNumber`: from the end of the heading to the end of
 * the section's last non-blank line. Null when there is no heading, or nothing under it.
 * A section ends at the next heading of the same or a higher level, so `###` folds under
 * its `##`.
 */
export function sectionRange(
  state: EditorState,
  lineNumber: number,
): { from: number; to: number } | null {
  const { doc } = state;
  const line = doc.line(lineNumber);
  const m = FOLDABLE.exec(line.text);
  if (!m) return null;
  const level = m[1].length;
  let last = lineNumber;
  for (let n = lineNumber + 1; n <= doc.lines; n++) {
    const text = doc.line(n).text;
    const h = HEADING.exec(text);
    if (h && h[1].length <= level) break;
    if (text.trim()) last = n;
  }
  if (last === lineNumber) return null;
  return { from: line.to, to: doc.line(last).to };
}

/** Whether the heading on `lineNumber` is currently folded. */
export function isFolded(state: EditorState, lineNumber: number): boolean {
  const range = sectionRange(state, lineNumber);
  if (!range) return false;
  let folded = false;
  foldedRanges(state).between(range.from, range.from, () => {
    folded = true;
  });
  return folded;
}

/** The effect that folds or unfolds the heading on `lineNumber`, or null if it cannot. */
export function toggleEffect(state: EditorState, lineNumber: number): StateEffect<unknown> | null {
  const range = sectionRange(state, lineNumber);
  if (!range) return null;
  return isFolded(state, lineNumber) ? unfoldEffect.of(range) : foldEffect.of(range);
}

/** Headings whose text matches, folded — for the Archive at open. */
export function foldEffectsFor(state: EditorState, headings: Iterable<string>): StateEffect<unknown>[] {
  const wanted = new Set(headings);
  const out: StateEffect<unknown>[] = [];
  for (let n = 1; n <= state.doc.lines; n++) {
    if (!wanted.has(state.doc.line(n).text.trim())) continue;
    const range = sectionRange(state, n);
    if (range) out.push(foldEffect.of(range));
  }
  return out;
}

/** The headings currently folded, by text — what is remembered for a file. */
export function foldedHeadings(state: EditorState): string[] {
  const out: string[] = [];
  foldedRanges(state).between(0, state.doc.length, (from) => {
    out.push(state.doc.lineAt(from).text.trim());
  });
  return out;
}

/** What a list opens with folded; a note, nothing. */
export function defaultFolds(state: EditorState, isList: boolean): StateEffect<unknown>[] {
  return foldEffectsFor(state, isList ? ["## Archive"] : []);
}

// ---- the chevron ------------------------------------------------------

class ToggleWidget extends WidgetType {
  readonly folded: boolean;
  readonly line: number;
  constructor(folded: boolean, line: number) {
    super();
    this.folded = folded;
    this.line = line;
  }
  eq(other: ToggleWidget) {
    return other.folded === this.folded && other.line === this.line;
  }
  toDOM() {
    const el = document.createElement("button");
    el.className = "cm-section-toggle";
    el.setAttribute("aria-expanded", String(!this.folded));
    el.setAttribute("aria-label", this.folded ? "Expand section" : "Collapse section");
    el.title = this.folded ? "Expand" : "Collapse";
    el.textContent = "";
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

function buildToggles(view: EditorView): DecorationSet {
  const { state } = view;
  const out: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      if (!FOLDABLE.test(line.text) || !sectionRange(state, line.number)) continue;
      // The cursor on the heading shows its raw markdown, and the chevron steps aside.
      const onLine = state.selection.ranges.some((r) => r.to >= line.from && r.from <= line.to);
      if (onLine) continue;
      out.push(
        Decoration.widget({
          widget: new ToggleWidget(isFolded(state, line.number), line.number),
          side: -1,
        }).range(line.from),
      );
    }
  }
  return Decoration.set(out, true);
}

const toggles = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildToggles(view);
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.selectionSet ||
        foldedRanges(u.startState) !== foldedRanges(u.state)
      ) {
        this.decorations = buildToggles(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

const clickToggle = EditorView.domEventHandlers({
  mousedown(event, view) {
    const el = (event.target as HTMLElement | null)?.closest?.(".cm-section-toggle");
    if (!el) return false;
    const pos = view.posAtDOM(el);
    const effect = toggleEffect(view.state, view.state.doc.lineAt(pos).number);
    if (effect) view.dispatch({ effects: effect });
    event.preventDefault();
    return true;
  },
});

// ---- assembly ----------------------------------------------------------

export function sectionFolding(): Extension {
  return [
    foldService.of((state, lineStart) => sectionRange(state, state.doc.lineAt(lineStart).number)),
    codeFolding({
      preparePlaceholder: (state, range) => {
        let tasks = 0;
        for (let n = state.doc.lineAt(range.from).number + 1; n <= state.doc.lineAt(range.to).number; n++) {
          if (TASK.test(state.doc.line(n).text)) tasks += 1;
        }
        return tasks;
      },
      placeholderDOM: (_view, onclick, tasks: number) => {
        const el = document.createElement("span");
        el.className = "cm-foldPlaceholder cm-section-folded";
        el.textContent = tasks ? `${tasks} task${tasks === 1 ? "" : "s"}` : "…";
        el.title = "Expand";
        el.addEventListener("click", onclick);
        return el;
      },
    }),
    toggles,
    clickToggle,
    keymap.of(foldKeymap),
  ];
}
