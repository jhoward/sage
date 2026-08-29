/**
 * Live preview: formatting is rendered, and its markers hide unless you are editing them.
 *
 * Built on the markdown syntax tree rather than per-line regexes. The first version used
 * regexes and could not see a span crossing a line break, so bold opened on one line and
 * closed three lines later simply did not render — while the `**` sat there in the text
 * looking like a mistake.
 *
 * Markers are hidden rather than dimmed, which reverses the choice made for provenance
 * markers, and for a reason: a provenance marker is something you go looking for in order
 * to delete, so it has to be visible. A formatting marker is something you edit in place,
 * where the cursor already is — so showing it whenever the cursor is inside the span gives
 * you it exactly when you need it and never when you do not.
 *
 * This is deliberately not a mode. There is no toggle because there is nothing to toggle
 * back to: put the cursor in the text and the raw markdown is right there.
 */

import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { EditorState, Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

/** Inline spans: the node to style, and the class to style it with. */
const INLINE: Record<string, string> = {
  StrongEmphasis: "cm-md-strong",
  Emphasis: "cm-md-em",
  InlineCode: "cm-md-code",
  Strikethrough: "cm-md-strike",
};

/** The marker children hidden when the cursor is elsewhere. */
const MARKS = new Set([
  "EmphasisMark",
  "CodeMark",
  "StrikethroughMark",
  "HeaderMark",
  "QuoteMark",
]);

const hidden = Decoration.replace({});
const headings = [1, 2, 3, 4, 5, 6].map((n) =>
  Decoration.line({ class: `cm-md-h${n}` }),
);
const quoteLine = Decoration.line({ class: "cm-md-quote" });
const marks = Object.fromEntries(
  Object.values(INLINE).map((c) => [c, Decoration.mark({ class: c })]),
);

/** Is any cursor or selection inside this range? */
function editing(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((r) => r.to >= from && r.from <= to);
}

/** Everything we draw, plus the hidden ranges alone — the two are used differently. */
interface Built {
  all: DecorationSet;
  /**
   * Only the replaced markers. atomicRanges must not include the styling marks: handing it
   * the whole set would make every bold span a single atomic unit, so arrowing through
   * bold text would jump the entire span instead of moving a character.
   */
  atomic: DecorationSet;
}

function build(view: EditorView): Built {
  const { state } = view;
  const all: Range<Decoration>[] = [];
  const atomic: Range<Decoration>[] = [];

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        const name = node.name;

        // Headings: size the line, hide the leading #s unless the cursor is on it.
        const heading = /^ATXHeading(\d)$/.exec(name);
        if (heading) {
          const line = state.doc.lineAt(node.from);
          all.push(headings[Number(heading[1]) - 1].range(line.from));
          return;
        }

        if (name === "Blockquote") {
          for (let pos = node.from; pos <= node.to; ) {
            const line = state.doc.lineAt(pos);
            all.push(quoteLine.range(line.from));
            pos = line.to + 1;
          }
          return;
        }

        const cls = INLINE[name];
        if (cls) {
          // A zero-length span would be an empty mark, which CodeMirror rejects.
          if (node.to > node.from) all.push(marks[cls].range(node.from, node.to));
          return;
        }

        // A marker inside something we styled. Hidden unless its span is being edited,
        // so the raw markdown is always one cursor move away.
        if (MARKS.has(name) && node.to > node.from) {
          const span = node.node.parent ?? node.node;
          if (!editing(state, span.from, span.to)) {
            const r = hidden.range(node.from, node.to);
            all.push(r);
            atomic.push(r);
          }
        }
      },
    });
  }

  // `true` sorts for us, which is what the ordering between line and inline decorations
  // at the same position needs — getting it wrong by hand throws at runtime.
  return { all: Decoration.set(all, true), atomic: Decoration.set(atomic, true) };
}

export function livePreviewExtension() {
  return ViewPlugin.fromClass(
    class {
      built: Built;
      constructor(view: EditorView) {
        this.built = build(view);
      }
      update(u: ViewUpdate) {
        // Selection matters as much as content here: moving the cursor into a span is
        // what reveals its markers.
        if (u.docChanged || u.viewportChanged || u.selectionSet) {
          this.built = build(u.view);
        }
      }
    },
    {
      decorations: (v) => v.built.all,
      // A hidden marker is not in the DOM, so without this the cursor can be parked
      // inside something invisible and arrow keys appear to skip a beat.
      provide: (plugin) =>
        EditorView.atomicRanges.of(
          (view) => view.plugin(plugin)?.built.atomic ?? Decoration.none,
        ),
    },
  );
}
