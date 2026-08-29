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
import type { SyntaxNode } from "@lezer/common";

/** Inline spans: the node to style, and the class to style it with. */
const INLINE: Record<string, string> = {
  StrongEmphasis: "cm-md-strong",
  Emphasis: "cm-md-em",
  InlineCode: "cm-md-code",
  Strikethrough: "cm-md-strike",
};

/**
 * Marker nodes, mapped to the parent that has to be styled before the marker may hide.
 *
 * The rule is the point: a marker is only hidden when the thing it belongs to is actually
 * rendered. A blanket list of marker names is what hid the ``` fences of a code block —
 * FencedCode also uses CodeMark, and since nothing styles a fenced block the fences simply
 * vanished and left the code looking like prose. Anything not rendered keeps its syntax.
 */
const MARKS: Record<string, (node: SyntaxNode) => boolean> = {
  EmphasisMark: (n) => parentIs(n, (p) => p === "StrongEmphasis" || p === "Emphasis"),
  StrikethroughMark: (n) => parentIs(n, (p) => p === "Strikethrough"),
  // Immediate parent, deliberately: it is the only thing separating an inline `code`
  // span from the ``` fence of a code block, which shares the node name.
  CodeMark: (n) => parentIs(n, (p) => p === "InlineCode"),
  HeaderMark: (n) => parentIs(n, (p) => /^ATXHeading\d$/.test(p)),
  // An ancestor walk, because only the first line's mark is a direct child of the
  // Blockquote — the rest hang off the Paragraph inside it.
  QuoteMark: (n) => !!ancestor(n, "Blockquote"),
};

function parentIs(node: SyntaxNode, ok: (name: string) => boolean): boolean {
  const parent = node.parent;
  return !!parent && ok(parent.name);
}

function ancestor(node: SyntaxNode, name: string): SyntaxNode | null {
  for (let n = node.parent; n; n = n.parent) if (n.name === name) return n;
  return null;
}

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
        const belongsTo = MARKS[name];
        if (belongsTo && node.to > node.from) {
          if (!belongsTo(node.node)) return;

          // A blockquote can run for many lines, and revealing every `>` because the
          // cursor is on one of them shifts every other line sideways — more disruptive
          // than the syntax it uncovers. Quote marks reveal per line; inline spans as a
          // whole, since those are what you edit as a unit.
          const scope =
            name === "QuoteMark"
              ? state.doc.lineAt(node.from)
              : (node.node.parent ?? node.node);

          if (!editing(state, scope.from, scope.to)) {
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
