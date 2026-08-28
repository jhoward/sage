/**
 * Live-preview styling: headings sized, bold bold, italics italic, code in a code face.
 *
 * Deliberately *not* a mode, and deliberately does not hide anything. Obsidian needs a
 * separate Source view because its Live Preview conceals syntax, so you sometimes need a
 * way back to the real text. Here the `**` and `#` markers stay — dimmed, still selectable,
 * still editable — so there is nothing to escape from and no toggle to remember.
 */

import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

const HEADING = /^(#{1,6})\s+(.*)$/;
const QUOTE = /^\s*>\s?/;
// Inline spans, longest-delimiter first so ** wins over *.
const INLINE: Array<[RegExp, string]> = [
  [/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "cm-md-strong"],
  [/(?<![*\w])(\*|_)(?=\S)([^*_\n]*?\S)\1(?![*\w])/g, "cm-md-em"],
  [/(`+)([^`\n]+?)\1/g, "cm-md-code"],
  [/(~~)(?=\S)([\s\S]*?\S)\1/g, "cm-md-strike"],
];

const marker = Decoration.mark({ class: "cm-md-marker" });
const quoteLine = Decoration.line({ class: "cm-md-quote" });
const headingLines = [1, 2, 3, 4, 5, 6].map((n) =>
  Decoration.line({ class: `cm-md-h${n}` }),
);
const inlineMarks = Object.fromEntries(
  ["cm-md-strong", "cm-md-em", "cm-md-code", "cm-md-strike"].map((c) => [
    c,
    Decoration.mark({ class: c }),
  ]),
);

function build(view: EditorView): DecorationSet {
  // Collected then sorted: CodeMirror requires ranges in document order, and inline spans
  // are found per-line while line decorations are added at the line start.
  const ranges: Array<{ from: number; to: number; deco: Decoration }> = [];

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      const text = line.text;

      const h = HEADING.exec(text);
      if (h) {
        ranges.push({ from: line.from, to: line.from, deco: headingLines[h[1].length - 1] });
        ranges.push({
          from: line.from,
          to: line.from + h[1].length + 1,
          deco: marker,
        });
      } else if (QUOTE.test(text)) {
        ranges.push({ from: line.from, to: line.from, deco: quoteLine });
      }

      // Fenced code and frontmatter delimiters read as noise; dim them.
      if (/^(```|~~~|---)\s*\w*$/.test(text.trim()) && text.trim()) {
        ranges.push({ from: line.from, to: line.to, deco: marker });
      }

      for (const [re, cls] of INLINE) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text))) {
          const start = line.from + m.index;
          const d = m[1].length;
          ranges.push({ from: start, to: start + d, deco: marker });
          ranges.push({
            from: start + d,
            to: start + m[0].length - d,
            deco: inlineMarks[cls],
          });
          ranges.push({
            from: start + m[0].length - d,
            to: start + m[0].length,
            deco: marker,
          });
        }
      }

      pos = line.to + 1;
    }
  }

  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  for (const r of ranges) builder.add(r.from, r.to, r.deco);
  return builder.finish();
}

export function livePreviewExtension() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) this.decorations = build(u.view);
      }
    },
    { decorations: (v) => v.decorations },
  );
}
