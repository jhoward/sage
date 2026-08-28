/**
 * Todo command logic, driven without a DOM.
 *
 * These commands are the daily workflow, so they are worth testing directly rather than
 * through the UI. A plain {state, dispatch} object stands in for the EditorView.
 */

import { describe, expect, it } from "vitest";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import {
  hideCompletedField,
  parseTask,
  promoteToTop,
  toggleTask,
} from "../todo";

function target(doc: string, cursorLine = 1) {
  let state = EditorState.create({ doc, extensions: [hideCompletedField] });
  const line = state.doc.line(cursorLine);
  state = state.update({ selection: { anchor: line.from } }).state;

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

const WEEK = `---
week: 2026-W35
---

## Now
- [ ] Finish the sync layer
- [x] Set up the repo

## This week
- [ ] Draft the planning doc
- [ ] Follow up on JIRA-482
`;

describe("parseTask", () => {
  it("recognises open and completed tasks", () => {
    const s = EditorState.create({ doc: "- [ ] open\n- [x] done\n- not a task" });
    expect(parseTask(s.doc.line(1))?.done).toBe(false);
    expect(parseTask(s.doc.line(2))?.done).toBe(true);
    expect(parseTask(s.doc.line(3))).toBeNull();
  });

  it("handles indentation and asterisk bullets", () => {
    const s = EditorState.create({ doc: "  * [ ] indented" });
    expect(parseTask(s.doc.line(1))?.text).toBe("indented");
  });
});

describe("toggleTask", () => {
  it("marks an open task done", () => {
    const t = target("- [ ] Finish the sync layer");
    expect(toggleTask(t)).toBe(true);
    expect(t.doc()).toBe("- [x] Finish the sync layer");
  });

  it("round-trips", () => {
    const t = target("- [x] Set up the repo");
    toggleTask(t);
    expect(t.doc()).toBe("- [ ] Set up the repo");
    toggleTask(t);
    expect(t.doc()).toBe("- [x] Set up the repo");
  });

  it("leaves non-task lines alone", () => {
    const t = target("## Now");
    expect(toggleTask(t)).toBe(false);
    expect(t.doc()).toBe("## Now");
  });

  it("preserves the task text exactly", () => {
    const t = target("- [ ] Follow up on JIRA-482 <!-- rolled:3 -->");
    toggleTask(t);
    expect(t.doc()).toBe("- [x] Follow up on JIRA-482 <!-- rolled:3 -->");
  });
});

describe("promoteToTop", () => {
  it("moves a task to the top of its own section", () => {
    // line 11 = "- [ ] Follow up on JIRA-482", under "## This week"
    const t = target(WEEK, 11);
    expect(promoteToTop(t)).toBe(true);

    const lines = t.doc().split("\n");
    const heading = lines.indexOf("## This week");
    expect(lines[heading + 1]).toBe("- [ ] Follow up on JIRA-482");
    expect(lines[heading + 2]).toBe("- [ ] Draft the planning doc");
  });

  it("does not cross into the section above", () => {
    const t = target(WEEK, 11);
    promoteToTop(t);
    const lines = t.doc().split("\n");
    // The "Now" section is untouched.
    const now = lines.indexOf("## Now");
    expect(lines[now + 1]).toBe("- [ ] Finish the sync layer");
    expect(lines[now + 2]).toBe("- [x] Set up the repo");
  });

  it("is a no-op when already at the top", () => {
    const t = target(WEEK, 6); // first task under "## Now"
    expect(promoteToTop(t)).toBe(false);
    expect(t.doc()).toBe(WEEK);
  });

  it("keeps every line when promoting", () => {
    const t = target(WEEK, 11);
    promoteToTop(t);
    expect(t.doc().split("\n").sort()).toEqual(WEEK.split("\n").sort());
  });
});
