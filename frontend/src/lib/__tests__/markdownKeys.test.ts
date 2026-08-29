/**
 * ⌘B and ⌘I.
 *
 * The multi-line cases matter more than the single-line ones: markdown emphasis cannot
 * cross a block boundary, so wrapping a run of list items in one pair of `**` produces
 * markdown that no renderer will display as bold. These tests pin that it wraps per line.
 */

import { describe, expect, it } from "vitest";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { bold, italic } from "../markdownKeys";

function target(doc: string, from: number, to = from) {
  let state = EditorState.create({ doc });
  state = state.update({ selection: { anchor: from, head: to } }).state;
  return {
    get state() {
      return state;
    },
    dispatch(spec: TransactionSpec) {
      state = state.update(spec).state;
    },
    doc: () => state.doc.toString(),
  };
}

/** Select whole lines, the way ⇧↓ or a drag does. */
function lines(doc: string, first: number, last: number) {
  const s = EditorState.create({ doc });
  return target(doc, s.doc.line(first).from, s.doc.line(last).to);
}

/** Shift-select downwards: the cursor lands at column 0 of the line *after* the last. */
function shiftDown(doc: string, first: number, throughLine: number) {
  const s = EditorState.create({ doc });
  return target(doc, s.doc.line(first).from, s.doc.line(throughLine + 1).from);
}

describe("single line", () => {
  it("wraps a selection", () => {
    const t = target("make this bold", 5, 9);
    bold(t as never);
    expect(t.doc()).toBe("make **this** bold");
  });

  it("toggles back off", () => {
    const t = target("make **this** bold", 7, 11);
    bold(t as never);
    expect(t.doc()).toBe("make this bold");
  });

  it("inserts markers with no selection", () => {
    const t = target("ab", 1);
    italic(t as never);
    expect(t.doc()).toBe("a**b");
    expect(t.state.selection.main.head).toBe(2);
  });
});

describe("across several lines", () => {
  it("wraps each list item inside its marker", () => {
    // The screenshot case. One pair of ** around all four parses as a paragraph plus an
    // unrelated list, and renders as literal asterisks.
    const doc = "- [ ] one\n- [ ] two\n- [ ] three";
    const t = lines(doc, 1, 3);
    bold(t as never);
    expect(t.doc()).toBe("- [ ] **one**\n- [ ] **two**\n- [ ] **three**");
  });

  it("never puts a marker before a list marker", () => {
    const t = lines("- one\n- two", 1, 2);
    bold(t as never);
    expect(t.doc()).not.toContain("**-");
  });

  it("handles plain paragraphs", () => {
    const t = lines("one\ntwo", 1, 2);
    bold(t as never);
    expect(t.doc()).toBe("**one**\n**two**");
  });

  it("skips blank lines rather than bolding nothing", () => {
    const t = lines("one\n\ntwo", 1, 3);
    bold(t as never);
    expect(t.doc()).toBe("**one**\n\n**two**");
  });

  it("respects ordered lists, quotes and headings", () => {
    const t = lines("1. one\n> two\n## three", 1, 3);
    bold(t as never);
    expect(t.doc()).toBe("1. **one**\n> **two**\n## **three**");
  });

  it("leaves trailing whitespace outside the markers", () => {
    const t = lines("one  \ntwo", 1, 2);
    bold(t as never);
    expect(t.doc()).toBe("**one**  \n**two**");
  });

  it("toggles off when every line is wrapped", () => {
    const t = lines("- **one**\n- **two**", 1, 2);
    bold(t as never);
    expect(t.doc()).toBe("- one\n- two");
  });

  it("completes a partly-bold selection instead of stripping it", () => {
    // Mixed means "make all of this bold", not "undo the half that already is".
    const t = lines("- **one**\n- two", 1, 2);
    bold(t as never);
    expect(t.doc()).toBe("- **one**\n- **two**");
  });

  it("ignores a line the selection only touches at column 0", () => {
    // ⇧↓ three times selects three lines and parks the cursor at the start of the fourth.
    // Nothing of that line is selected, so it must not be bolded.
    const doc = "- one\n- two\n- three\n- four";
    const t = shiftDown(doc, 1, 3);
    bold(t as never);
    expect(t.doc()).toBe("- **one**\n- **two**\n- **three**\n- four");
  });

  it("still wraps a line the selection genuinely reaches into", () => {
    // One character past column 0 means the line is part of the selection.
    const doc = "- one\n- two";
    const s = EditorState.create({ doc });
    const t = target(doc, s.doc.line(1).from, s.doc.line(2).from + 3);
    bold(t as never);
    expect(t.doc()).toBe("- **one**\n- **two**");
  });

  it("a selection ending at column 0 of the next line still wraps one line", () => {
    const doc = "- one\n- two";
    const s = EditorState.create({ doc });
    const t = target(doc, s.doc.line(1).from, s.doc.line(2).from);
    bold(t as never);
    expect(t.doc()).toBe("- **one**\n- two");
  });

  it("italic works the same way", () => {
    const t = lines("- one\n- two", 1, 2);
    italic(t as never);
    expect(t.doc()).toBe("- *one*\n- *two*");
  });
});
