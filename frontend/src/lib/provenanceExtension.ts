/**
 * Dims `<!-- sage:ai … -->` regions so generated text is visible as generated.
 *
 * The markers stay as ordinary editable text rather than being hidden or turned into
 * widgets: they are part of the file, they survive a round trip through any other editor,
 * and a marker you cannot see is one you cannot delete when you have made the text yours.
 */

import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { isCloseMarker, isOpenMarker } from "./provenance";

const markerLine = Decoration.line({ class: "cm-ai-marker" });
const generatedLine = Decoration.line({ class: "cm-ai-generated" });

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  let inside = false;

  // Whole document, not just the viewport: a region can start above the fold, and
  // guessing from partial state would mis-shade everything below it.
  for (let n = 1; n <= view.state.doc.lines; n++) {
    const line = view.state.doc.line(n);
    if (isOpenMarker(line.text)) {
      inside = true;
      builder.add(line.from, line.from, markerLine);
    } else if (isCloseMarker(line.text)) {
      inside = false;
      builder.add(line.from, line.from, markerLine);
    } else if (inside) {
      builder.add(line.from, line.from, generatedLine);
    }
  }
  return builder.finish();
}

export function provenanceExtension() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged) this.decorations = build(u.view);
      }
    },
    { decorations: (v) => v.decorations },
  );
}
