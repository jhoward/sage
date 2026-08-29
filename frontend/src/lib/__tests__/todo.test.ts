/**
 * Todo command logic, driven without a DOM.
 *
 * These commands are the daily workflow, so they are worth testing directly rather than
 * through the UI. A plain {state, dispatch} object stands in for the EditorView.
 */

import { describe, expect, it } from "vitest";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import {
  continueList,
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

describe("continueList", () => {
  it("opens another task after a task", () => {
    const t = target("- [ ] First");
    // Cursor to end of line.
    t.dispatch({ selection: { anchor: t.state.doc.line(1).to } });
    expect(continueList(t)).toBe(true);
    expect(t.doc()).toBe("- [ ] First\n- [ ] ");
  });

  it("opens another bullet after a plain bullet", () => {
    const t = target("- First");
    t.dispatch({ selection: { anchor: t.state.doc.line(1).to } });
    continueList(t);
    expect(t.doc()).toBe("- First\n- ");
  });

  it("exits the list on an empty item rather than adding another", () => {
    const t = target("- [ ] ");
    t.dispatch({ selection: { anchor: t.state.doc.line(1).to } });
    expect(continueList(t)).toBe(true);
    expect(t.doc()).toBe("");
  });

  it("preserves indentation", () => {
    const t = target("  - [ ] Nested");
    t.dispatch({ selection: { anchor: t.state.doc.line(1).to } });
    continueList(t);
    expect(t.doc()).toBe("  - [ ] Nested\n  - [ ] ");
  });

  it("does nothing on an ordinary line", () => {
    const t = target("Just prose");
    t.dispatch({ selection: { anchor: t.state.doc.line(1).to } });
    expect(continueList(t)).toBe(false);
  });

  it("does not hijack Enter mid-line", () => {
    const t = target("- [ ] First");
    t.dispatch({ selection: { anchor: 8 } });
    expect(continueList(t)).toBe(false);
  });
});

describe("toggleTask on a plain line", () => {
  it("turns prose into a task", () => {
    const t = target("Call the dentist");
    expect(toggleTask(t)).toBe(true);
    expect(t.doc()).toBe("- [ ] Call the dentist");
  });

  it("turns a plain bullet into a task, keeping indentation", () => {
    const t = target("  - Call the dentist");
    toggleTask(t);
    expect(t.doc()).toBe("  - [ ] Call the dentist");
  });

  it("then completes it on a second press", () => {
    const t = target("Call the dentist");
    toggleTask(t);
    toggleTask(t);
    expect(t.doc()).toBe("- [x] Call the dentist");
  });

  it("leaves a blank line alone", () => {
    const t = target("");
    expect(toggleTask(t)).toBe(false);
  });
});

describe("toggleTask leaves structure alone", () => {
  it.each([
    ["## Now", "a heading"],
    ["> a quote", "a blockquote"],
    ["```", "a fence"],
    ["---", "a rule"],
    ["week: 2026-08-23", "frontmatter"],
  ])("does not turn %s into a task (%s)", (line) => {
    const t = target(line);
    expect(toggleTask(t)).toBe(false);
    expect(t.doc()).toBe(line);
  });
});

describe("toggleTask across a selection", () => {
  function selecting(doc: string, fromLine: number, toLine: number) {
    const t = target(doc);
    t.dispatch({
      selection: {
        anchor: t.state.doc.line(fromLine).from,
        head: t.state.doc.line(toLine).to,
      },
    });
    return t;
  }

  const MIXED = "- [ ] One\n- [x] Two\n- [ ] Three";

  it("finishes everything when any item is unfinished", () => {
    // The bug: flipping each independently unchecked "Two" while checking the others.
    const t = selecting(MIXED, 1, 3);
    toggleTask(t);
    expect(t.doc()).toBe("- [x] One\n- [x] Two\n- [x] Three");
  });

  it("unfinishes everything only when all are finished", () => {
    const t = selecting("- [x] One\n- [x] Two", 1, 2);
    toggleTask(t);
    expect(t.doc()).toBe("- [ ] One\n- [ ] Two");
  });

  it("is idempotent — a second press on a finished batch unfinishes once", () => {
    const t = selecting(MIXED, 1, 3);
    toggleTask(t);
    toggleTask(t);
    expect(t.doc()).toBe("- [ ] One\n- [ ] Two\n- [ ] Three");
  });

  it("still flips a single line", () => {
    const t = target("- [ ] One");
    toggleTask(t);
    expect(t.doc()).toBe("- [x] One");
  });

  it("ignores non-task lines inside the selection", () => {
    const t = selecting("## Now\n- [ ] One\n\n- [ ] Two", 1, 4);
    toggleTask(t);
    expect(t.doc()).toBe("## Now\n- [x] One\n\n- [x] Two");
  });

  it("converts a selection of plain lines into tasks", () => {
    const t = selecting("Call the dentist\nBook the venue", 1, 2);
    toggleTask(t);
    expect(t.doc()).toBe("- [ ] Call the dentist\n- [ ] Book the venue");
  });
})
