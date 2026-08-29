/**
 * Live preview, driven through a real EditorView.
 *
 * A real view is needed rather than a bare state because the plugin works over
 * `visibleRanges` and reacts to selection. The regression that prompted the rewrite —
 * bold opening on one line and closing three lines later, rendering as nothing at all —
 * is the first test here.
 */

import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { livePreviewExtension } from "../livePreview";

function view(doc: string, cursor = 0) {
  return new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.single(cursor),
      extensions: [markdown(), livePreviewExtension()],
    }),
    parent: document.body,
  });
}

/** Every decoration currently drawn, as {from, to, class or "hidden"}. */
function decorations(v: EditorView) {
  const out: Array<{ from: number; to: number; what: string }> = [];
  for (const set of v.state.facet(EditorView.decorations)) {
    const value = typeof set === "function" ? set(v) : set;
    const iter = value.iter();
    while (iter.value) {
      // A replace decoration carries no class, which is how a hidden marker is spotted.
      out.push({ from: iter.from, to: iter.to, what: iter.value.spec.class ?? "hidden" });
      iter.next();
    }
  }
  return out;
}

const classes = (v: EditorView, cls: string) =>
  decorations(v).filter((d) => d.what === cls);
const hiddenRanges = (v: EditorView) =>
  decorations(v).filter((d) => d.what === "hidden");

describe("live preview across lines", () => {
  it("renders bold that spans a soft line break", () => {
    // The case the per-line regex structurally could not see: one paragraph, ** opening
    // on the first line and closing on the second.
    const doc = "**one\ntwo**";
    const v = view(doc, 0);
    const strong = classes(v, "cm-md-strong");

    expect(strong).toHaveLength(1);
    expect(strong[0].from).toBe(0);
    expect(strong[0].to).toBe(doc.length);
    v.destroy();
  });

  it("does not fake bold across a block boundary", () => {
    // The shape in the bug report. Emphasis cannot cross a block boundary, so this is a
    // paragraph followed by an unrelated list and the ** are literal — which is exactly
    // what GitHub and Obsidian show. Rendering it as bold would be a lie about the file;
    // ⌘B is what was fixed, so this markdown is no longer produced in the first place.
    const doc = "**- [ ] one\n- [ ] two\n- [ ] three**";
    const v = view(doc, doc.length);
    expect(classes(v, "cm-md-strong")).toHaveLength(0);
    expect(hiddenRanges(v)).toHaveLength(0); // and nothing is hidden, so it stays editable
    v.destroy();
  });

  it("renders what ⌘B now produces for a multi-line selection", () => {
    const doc = "- [ ] **one**\n- [ ] **two**\n- [ ] **three**";
    const v = view(doc, 0);
    expect(classes(v, "cm-md-strong")).toHaveLength(3);
    v.destroy();
  });

  it("renders bold on a single line", () => {
    const v = view("plain **bold** plain", 0);
    expect(classes(v, "cm-md-strong")).toHaveLength(1);
    v.destroy();
  });

  it("does not treat a lone asterisk as emphasis", () => {
    // 2 * 3 * 4 is arithmetic, not italics. The regex version got this wrong.
    const v = view("2 * 3 * 4 is twenty four", 0);
    expect(classes(v, "cm-md-em")).toHaveLength(0);
    v.destroy();
  });
});

describe("markers hide unless you are editing them", () => {
  const doc = "before\n\n**bold text**\n\nafter";
  const boldAt = doc.indexOf("bold text");

  it("hides the ** when the cursor is elsewhere", () => {
    const v = view(doc, 0);
    const marks = hiddenRanges(v);
    expect(marks).toHaveLength(2);
    // Exactly the two ** and nothing else.
    for (const m of marks) expect(m.to - m.from).toBe(2);
    v.destroy();
  });

  it("shows them again when the cursor is inside the span", () => {
    const v = view(doc, boldAt + 2);
    expect(hiddenRanges(v)).toHaveLength(0);
    v.destroy();
  });

  it("reveals them on cursor move, without the document changing", () => {
    const v = view(doc, 0);
    expect(hiddenRanges(v)).toHaveLength(2);

    v.dispatch({ selection: EditorSelection.single(boldAt + 2) });
    expect(hiddenRanges(v)).toHaveLength(0);
    expect(v.state.doc.toString()).toBe(doc);

    v.dispatch({ selection: EditorSelection.single(0) });
    expect(hiddenRanges(v)).toHaveLength(2);
    v.destroy();
  });

  it("keeps the styling while the markers are visible", () => {
    // Revealing the syntax must not un-bold the text, or editing it would make the
    // line jump around.
    const v = view(doc, boldAt + 2);
    expect(classes(v, "cm-md-strong")).toHaveLength(1);
    v.destroy();
  });

  it("hides heading #s but keeps the heading style", () => {
    const v = view("# Title\n\nbody", 10);
    expect(classes(v, "cm-md-h1")).toHaveLength(1);
    expect(hiddenRanges(v).length).toBeGreaterThan(0);
    v.destroy();
  });
});

describe("hidden markers are atomic", () => {
  it("marks only the hidden ranges atomic, never the styled span", () => {
    // Handing atomicRanges the whole set would make a bold span one atomic unit, so
    // arrowing through bold text would skip the entire thing.
    const doc = "**bold text here**\n\nelsewhere";
    const v = view(doc, doc.length);

    let total = 0;
    let widest = 0;
    for (const get of v.state.facet(EditorView.atomicRanges)) {
      const iter = get(v).iter();
      while (iter.value) {
        total += 1;
        widest = Math.max(widest, iter.to - iter.from);
        iter.next();
      }
    }

    expect(total).toBe(2);
    expect(widest).toBe(2); // the ** only — not the 18-char span
    v.destroy();
  });
});

describe("it never alters the document", () => {
  it("leaves the markdown exactly as written", () => {
    const doc = "# Head\n\n**bold**\n\n- [ ] task `code`\n\n> quote";
    const v = view(doc, 0);
    expect(v.state.doc.toString()).toBe(doc);
    v.destroy();
  });
});
