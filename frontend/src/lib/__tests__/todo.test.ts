/**
 * Todo command logic, driven without a DOM.
 *
 * These commands are the daily workflow, so they are worth testing directly rather than
 * through the UI. A plain {state, dispatch} object stands in for the EditorView.
 */

import { describe, expect, it } from "vitest";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import {
  listLabel,
  continueList,
  setClock,
  setDoneChanges,
  moveToSection,
  indentListItem,
  outdentListItem,
  hideCompletedField,
  parseTask,
  promoteToTop,
  deleteLines,
  todoCommands,
  toggleTask,
  untask,
} from "../todo";

setClock(() => "2026-10-04");
const DONE = "<!-- done:2026-10-04 -->";

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

const WEEK = `# General

The default list.

## Now
- [ ] Finish the sync layer
- [x] Set up the repo

## Backlog
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
  it("marks an open task done, and stamps the day", () => {
    const t = target("- [ ] Finish the sync layer");
    expect(toggleTask(t)).toBe(true);
    expect(t.doc()).toBe(`- [x] Finish the sync layer ${DONE}`);
  });

  it("round-trips, leaving no trace of a mistaken tick", () => {
    const t = target("- [x] Set up the repo <!-- done:2026-09-30 -->");
    toggleTask(t);
    expect(t.doc()).toBe("- [ ] Set up the repo");
    toggleTask(t);
    expect(t.doc()).toBe(`- [x] Set up the repo ${DONE}`);
  });

  it("unchecks a task that was never stamped", () => {
    const t = target("- [x] Set up the repo");
    toggleTask(t);
    expect(t.doc()).toBe("- [ ] Set up the repo");
  });

  it("leaves non-task lines alone", () => {
    const t = target("## Now");
    expect(toggleTask(t)).toBe(false);
    expect(t.doc()).toBe("## Now");
  });

  it("keeps other metadata in the one comment", () => {
    const t = target("- [ ] Follow up on JIRA-482 <!-- rolled:3 -->");
    toggleTask(t);
    expect(t.doc()).toBe("- [x] Follow up on JIRA-482 <!-- rolled:3 done:2026-10-04 -->");
    toggleTask(t);
    expect(t.doc()).toBe("- [ ] Follow up on JIRA-482 <!-- rolled:3 -->");
  });

  it("stamps a numbered task too", () => {
    const t = target("3. [ ] Grade homework");
    toggleTask(t);
    expect(t.doc()).toBe(`3. [x] Grade homework ${DONE}`);
  });
});

describe("setDoneChanges", () => {
  it("reads where the comment starts, including the space before it", () => {
    const s = EditorState.create({ doc: "- [ ] A task <!-- done:2026-01-01 -->" });
    const task = parseTask(s.doc.line(1))!;
    expect(task.meta).toEqual({ done: "2026-01-01" });
    expect(s.doc.sliceString(task.metaFrom)).toBe(" <!-- done:2026-01-01 -->");
    expect(setDoneChanges(task, false)).toEqual([
      { from: task.markPos, to: task.markPos + 1, insert: " " },
      { from: task.metaFrom, to: s.doc.line(1).to, insert: "" },
    ]);
  });
});

describe("promoteToTop", () => {
  it("moves a task to the top of its own section", () => {
    // line 11 = "- [ ] Follow up on JIRA-482", under "## This week"
    const t = target(WEEK, 11);
    expect(promoteToTop(t)).toBe(true);

    const lines = t.doc().split("\n");
    const heading = lines.indexOf("## Backlog");
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
    expect(t.doc()).toBe(`- [x] Call the dentist ${DONE}`);
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
    expect(t.doc()).toBe(`- [x] One ${DONE}\n- [x] Two\n- [x] Three ${DONE}`);
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
    expect(t.doc()).toBe(`- [x] One ${DONE}`);
  });

  it("ignores non-task lines inside the selection", () => {
    const t = selecting("## Now\n- [ ] One\n\n- [ ] Two", 1, 4);
    toggleTask(t);
    expect(t.doc()).toBe(`## Now\n- [x] One ${DONE}\n\n- [x] Two ${DONE}`);
  });

  it("converts a selection of plain lines into tasks", () => {
    const t = selecting("Call the dentist\nBook the venue", 1, 2);
    toggleTask(t);
    expect(t.doc()).toBe("- [ ] Call the dentist\n- [ ] Book the venue");
  });
})

describe("Tab indents list items", () => {
  it("indents the current line", () => {
    const t = target("- [ ] Task");
    expect(indentListItem(t)).toBe(true);
    expect(t.doc()).toBe("  - [ ] Task");
  });

  it("outdents again", () => {
    const t = target("  - [ ] Task");
    outdentListItem(t);
    expect(t.doc()).toBe("- [ ] Task");
  });

  it("outdenting an unindented line leaves it alone", () => {
    const t = target("- [ ] Task");
    outdentListItem(t);
    expect(t.doc()).toBe("- [ ] Task");
  });

  it("indents every line in a selection", () => {
    const t = target("- [ ] One\n- [ ] Two");
    t.dispatch({
      selection: { anchor: t.state.doc.line(1).from, head: t.state.doc.line(2).to },
    });
    indentListItem(t);
    expect(t.doc()).toBe("  - [ ] One\n  - [ ] Two");
  });

  it("round-trips", () => {
    const t = target("- [ ] Task");
    indentListItem(t);
    indentListItem(t);
    outdentListItem(t);
    outdentListItem(t);
    expect(t.doc()).toBe("- [ ] Task");
  });

  it("continueList keeps the new indentation", () => {
    // Indent, then Enter: the next item should line up with the one you just indented.
    const t = target("- [ ] Task");
    indentListItem(t);
    t.dispatch({ selection: { anchor: t.state.doc.line(1).to } });
    continueList(t);
    expect(t.doc()).toBe("  - [ ] Task\n  - [ ] ");
  });
});

/** Cursor at the end of a line, which is where Enter and Tab are pressed. */
function atEndOf(doc: string, lineNumber: number) {
  const t = target(doc);
  t.dispatch({ selection: { anchor: t.state.doc.line(lineNumber).to } });
  return t;
}

describe("numbered lists", () => {
  it("a numbered task is a task", () => {
    const s = EditorState.create({ doc: "1. [ ] open\n2) [x] done\n3. plain" });
    expect(parseTask(s.doc.line(1))?.done).toBe(false);
    expect(parseTask(s.doc.line(2))?.done).toBe(true);
    expect(parseTask(s.doc.line(3))).toBeNull();
  });

  it("making a numbered item a task keeps its number", () => {
    const t = target("1. Buy milk");
    toggleTask(t);
    expect(t.doc()).toBe("1. [ ] Buy milk");
    toggleTask(t);
    expect(t.doc()).toBe(`1. [x] Buy milk ${DONE}`);
  });

  it("Enter continues the number and the box", () => {
    const t = atEndOf("1. [ ] One", 1);
    continueList(t);
    expect(t.doc()).toBe("1. [ ] One\n2. [ ] ");
    expect(t.state.selection.main.head).toBe(t.state.doc.length);
  });

  it("Enter continues a plain numbered list", () => {
    const t = atEndOf("1) One", 1);
    continueList(t);
    expect(t.doc()).toBe("1) One\n2) ");
  });

  it("Enter in the middle renumbers what follows, in one undoable step", () => {
    const t = atEndOf("1. One\n2. Two\n3. Three", 1);
    continueList(t);
    expect(t.doc()).toBe("1. One\n2. \n3. Two\n4. Three");
    expect(t.state.doc.lineAt(t.state.selection.main.head).number).toBe(2);
  });

  it("a list that starts at 4 on purpose stays that way", () => {
    const t = atEndOf("4. Four\n5. Five", 2);
    continueList(t);
    expect(t.doc()).toBe("4. Four\n5. Five\n6. ");
  });

  it("Tab nests under the item above, restarts at 1, and closes the gap", () => {
    const t = atEndOf("1. a\n2. b\n3. c\n4. d\n5. e\n6. f", 5);
    indentListItem(t);
    expect(t.doc()).toBe("1. a\n2. b\n3. c\n4. d\n   1. e\n5. f");
  });

  it("a second nested item counts on from the first", () => {
    const t = atEndOf("1. a\n   1. b\n2. c\n3. d", 3);
    indentListItem(t);
    expect(t.doc()).toBe("1. a\n   1. b\n   2. c\n2. d");
  });

  it("nests under the text of a two-digit item", () => {
    const t = atEndOf("10. a\n11. b", 2);
    indentListItem(t);
    expect(t.doc()).toBe("10. a\n    1. b");
  });

  it("Shift-Tab rejoins the outer list and renumbers both levels", () => {
    const t = atEndOf("1. a\n   1. b\n   2. c\n2. d", 2);
    outdentListItem(t);
    expect(t.doc()).toBe("1. a\n2. b\n   1. c\n3. d");
  });

  it("children move with their parent", () => {
    const t = atEndOf("- a\n- b\n  - child\n- c", 2);
    indentListItem(t);
    expect(t.doc()).toBe("- a\n  - b\n    - child\n- c");
  });

  it("a bullet under a numbered item lines up with its text", () => {
    const t = atEndOf("1. [ ] a\n- b", 2);
    indentListItem(t);
    expect(t.doc()).toBe("1. [ ] a\n   - b");
  });
});

describe("untask", () => {
  it("removes the box and keeps the bullet", () => {
    const t = target("- [ ] Task");
    expect(untask(t)).toBe(true);
    expect(t.doc()).toBe("- Task");
  });

  it("keeps the number, and drops a completed box too", () => {
    const t = target("  3. [x] Task");
    untask(t);
    expect(t.doc()).toBe("  3. Task");
  });

  it("is the inverse of making a task from a list item", () => {
    const t = target("1. Buy milk");
    toggleTask(t);
    untask(t);
    expect(t.doc()).toBe("1. Buy milk");
  });

  it("leaves a line that is not a task alone", () => {
    const t = target("Just a sentence");
    expect(untask(t)).toBe(false);
    expect(t.doc()).toBe("Just a sentence");
  });

  it("untasks every task in a selection", () => {
    const t = target("- [ ] One\nprose\n- [x] Two");
    t.dispatch({ selection: { anchor: 0, head: t.state.doc.length } });
    untask(t);
    expect(t.doc()).toBe("- One\nprose\n- Two");
  });
});

describe("a selection that ends at the start of the next line", () => {
  // What shift-↓ produces: three lines selected, cursor parked at column 0 of the fourth.
  function throughLineBreak(doc: string, fromLine: number, toLineStart: number) {
    const t = target(doc);
    t.dispatch({
      selection: {
        anchor: t.state.doc.line(fromLine).from,
        head: t.state.doc.line(toLineStart).from,
      },
    });
    return t;
  }

  it("does not complete the task below", () => {
    const t = throughLineBreak("- [ ] One\n- [ ] Two\n- [ ] Three", 1, 3);
    toggleTask(t);
    expect(t.doc()).toBe(`- [x] One ${DONE}\n- [x] Two ${DONE}\n- [ ] Three`);
  });

  it("does not make a task of the line below", () => {
    const t = throughLineBreak("One\nTwo\nThree", 1, 3);
    toggleTask(t);
    expect(t.doc()).toBe("- [ ] One\n- [ ] Two\nThree");
  });

  it("does not let the untouched line decide the batch", () => {
    // Both selected tasks are done, so the batch should uncheck — the open task below
    // used to count, and flipped the decision to "finish everything".
    const t = throughLineBreak("- [x] One\n- [x] Two\n- [ ] Three", 1, 3);
    toggleTask(t);
    expect(t.doc()).toBe("- [ ] One\n- [ ] Two\n- [ ] Three");
  });

  it("does not untask or indent the line below either", () => {
    const u = throughLineBreak("- [ ] One\n- [ ] Two", 1, 2);
    untask(u);
    expect(u.doc()).toBe("- One\n- [ ] Two");

    const i = throughLineBreak("- a\n- b\n- c", 2, 3);
    indentListItem(i);
    expect(i.doc()).toBe("- a\n  - b\n- c");
  });

  it("still acts on the line a bare cursor sits at the start of", () => {
    const t = target("- [ ] One\n- [ ] Two", 2);
    toggleTask(t);
    expect(t.doc()).toBe(`- [ ] One\n- [x] Two ${DONE}`);
  });
});

describe("moving and deleting lines keeps a numbered list in order", () => {
  it("deleting an item closes the gap", () => {
    const t = target("1. a\n2. b\n3. c\n4. d", 2);
    todoCommands.deleteLine(t);
    expect(t.doc()).toBe("1. a\n2. c\n3. d");
    expect(t.state.doc.lineAt(t.state.selection.main.head).number).toBe(2);
  });

  it("deleting the first item does not leave the list starting at 2", () => {
    const t = target("1. a\n2. b\n3. c", 1);
    todoCommands.deleteLine(t);
    expect(t.doc()).toBe("1. b\n2. c");
  });

  it("a list that starts at 4 on purpose still does after a delete", () => {
    const t = target("4. a\n5. b\n6. c", 1);
    todoCommands.deleteLine(t);
    expect(t.doc()).toBe("4. b\n5. c");
  });

  it("nudging an item up swaps the numbers with it", () => {
    const t = target("1. a\n2. b\n3. c", 3);
    todoCommands.lineUp(t);
    expect(t.doc()).toBe("1. a\n2. c\n3. b");
  });

  it("nudging the second item above the first keeps the list starting at 1", () => {
    const t = target("1. a\n2. b", 2);
    todoCommands.lineUp(t);
    expect(t.doc()).toBe("1. b\n2. a");
  });

  it("nudging down works the same way, and the cursor follows the line", () => {
    const t = target("1. [ ] a\n2. [ ] b\n3. [ ] c", 1);
    todoCommands.lineDown(t);
    expect(t.doc()).toBe("1. [ ] b\n2. [ ] a\n3. [ ] c");
    expect(t.state.doc.lineAt(t.state.selection.main.head).number).toBe(2);
  });

  it("promoting to the top renumbers the whole list", () => {
    const t = target("## Now\n1. a\n2. b\n3. c\n", 4);
    todoCommands.promote(t);
    expect(t.doc()).toBe("## Now\n1. c\n2. a\n3. b\n");
  });

  it("leaves bullets and prose alone", () => {
    const t = target("- a\n- b\nprose", 2);
    todoCommands.lineUp(t);
    expect(t.doc()).toBe("- b\n- a\nprose");
  });
});

describe("deleteLines", () => {
  it("deletes the last line without leaving a blank one", () => {
    const t = target("one\ntwo", 2);
    deleteLines(t);
    expect(t.doc()).toBe("one");
  });

  it("deletes the only line", () => {
    const t = target("one");
    deleteLines(t);
    expect(t.doc()).toBe("");
  });

  it("deletes every selected line, but not the one a selection merely reaches", () => {
    const t = target("one\ntwo\nthree\nfour");
    t.dispatch({
      selection: { anchor: t.state.doc.line(1).from, head: t.state.doc.line(3).from },
    });
    deleteLines(t);
    expect(t.doc()).toBe("three\nfour");
  });

  it("keeps the cursor's column on the line that moves up", () => {
    const t = target("abcdef\nxy\nlonger line");
    t.dispatch({ selection: { anchor: 4 } });
    deleteLines(t);
    expect(t.state.selection.main.head).toBe(2); // clamped to the end of "xy"
  });
});

describe("moving a task to another section", () => {
  it("to the Backlog: appended at the end, as a bullet", () => {
    const t = target(WEEK, 6);
    expect(todoCommands.toBacklog(t)).toBe(true);
    expect(t.doc()).toBe(`# General

The default list.

## Now
- [x] Set up the repo

## Backlog
- [ ] Draft the planning doc
- [ ] Follow up on JIRA-482
- [ ] Finish the sync layer
`);
    expect(t.state.doc.lineAt(t.state.selection.main.head).text).toBe("- [ ] Finish the sync layer");
  });

  it("to Now, bringing its children and dropping its number", () => {
    const t = target("## Now\n- [ ] a\n\n## Backlog\n1. [ ] b\n   - a note under b\n2. [ ] c\n", 5);
    todoCommands.toNow(t);
    expect(t.doc()).toBe("## Now\n- [ ] a\n- [ ] b\n  - a note under b\n\n## Backlog\n1. [ ] c\n");
  });

  it("into an empty section, straight under the heading", () => {
    const t = target("## Now\n\n## Backlog\n- [ ] b\n", 4);
    todoCommands.toNow(t);
    expect(t.doc()).toBe("## Now\n- [ ] b\n\n## Backlog\n");
  });

  it("creates the heading at the end when the file has none", () => {
    const t = target("## Now\n- [ ] a\n- [ ] b\n", 2);
    todoCommands.toBacklog(t);
    expect(t.doc()).toBe("## Now\n- [ ] b\n\n## Backlog\n- [ ] a");
  });

  it("does nothing to a task already there, or to a line that is not a task", () => {
    const t = target(WEEK, 10);
    expect(todoCommands.toBacklog(t)).toBe(true);
    expect(t.doc()).toBe(WEEK);
    const u = target(WEEK, 5);
    expect(moveToSection("## Backlog")(u)).toBe(false);
  });

  it("moves every selected task", () => {
    const t = target(WEEK, 10);
    t.dispatch({ selection: { anchor: t.state.doc.line(10).from, head: t.state.doc.line(11).to } });
    todoCommands.toNow(t);
    expect(t.doc()).toBe(`# General

The default list.

## Now
- [ ] Finish the sync layer
- [x] Set up the repo
- [ ] Draft the planning doc
- [ ] Follow up on JIRA-482

## Backlog
`);
  });
});

describe("how a task is labelled when pulling", () => {
  const task = (section: string, path = "todo/occam.md", list?: string) => ({ path, section, list });

  it("by its list's title", () => {
    expect(listLabel(task("## Backlog", "todo/occam.md", "Occam Features"))).toBe("Occam Features");
  });

  it("by its file when there is no title", () => {
    expect(listLabel(task("## Backlog"))).toBe("occam");
  });

  it("with the section, when it is not the ordinary Backlog", () => {
    expect(listLabel(task("## Someday", "todo/occam.md", "Occam"))).toBe("Occam › Someday");
  });
});
