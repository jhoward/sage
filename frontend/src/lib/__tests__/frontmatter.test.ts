import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  bodyStart,
  frontmatterExtension,
  headerFor,
  parseFrontmatter,
  weekNumber,
} from "../frontmatter";

const WEEK = "---\nweek: 2026-09-13\ndates: Sep 13 – 19\n---\n\n## Now\n- [ ] One\n";

const stateOf = (doc: string) => EditorState.create({ doc });

describe("parseFrontmatter", () => {
  it("reads the fields and where the block ends", () => {
    const fm = parseFrontmatter(stateOf(WEEK))!;
    expect(fm.fields).toEqual({ week: "2026-09-13", dates: "Sep 13 – 19" });
    expect(fm.lastLine).toBe(4);
  });

  it("is not fooled by a note that opens with a rule and never closes it", () => {
    expect(parseFrontmatter(stateOf("---\njust a rule above some prose\n"))).toBeNull();
  });

  it("ignores a --- that is not on the first line", () => {
    expect(parseFrontmatter(stateOf("# Title\n---\nweek: x\n---\n"))).toBeNull();
  });

  it("the note proper starts after the block and its blank line", () => {
    const s = stateOf(WEEK);
    expect(s.doc.lineAt(bodyStart(s)).text).toBe("## Now");
    expect(bodyStart(stateOf("no frontmatter"))).toBe(0);
  });
});

describe("weekNumber", () => {
  it("gives a week the number its old W-named file had", () => {
    // The backend's migration renamed 2026-W35.md to 2026-08-23.md.
    expect(weekNumber("2026-08-23")).toEqual({ week: 35, year: 2026 });
    expect(weekNumber("2026-09-13")).toEqual({ week: 38, year: 2026 });
  });

  it("uses the ISO year at the turn of the year", () => {
    expect(weekNumber("2026-12-27")).toEqual({ week: 53, year: 2026 });
    expect(weekNumber("2027-01-03")).toEqual({ week: 1, year: 2027 });
    // Sunday Dec 29, 2024 begins the week of Monday Dec 30 — week 1 of 2025.
    expect(weekNumber("2024-12-29")).toEqual({ week: 1, year: 2025 });
  });

  it("is unmoved by daylight saving", () => {
    expect(weekNumber("2026-03-08")).toEqual({ week: 11, year: 2026 });
    expect(weekNumber("2026-11-01")).toEqual({ week: 45, year: 2026 });
  });

  it("returns null for anything that is not a date, such as a legacy 2026-W35", () => {
    expect(weekNumber("2026-W35")).toBeNull();
    expect(weekNumber("")).toBeNull();
  });
});

describe("headerFor", () => {
  it("falls back to a bare label when the week is not a date", () => {
    expect(headerFor({ week: "2026-W35", dates: "Aug 23 – 29" }).overline).toBe("Week");
  });

  it("a week is titled by its dates", () => {
    expect(headerFor({ week: "2026-09-13", dates: "Sep 13 – 19" })).toEqual({
      overline: "Week 38 · 2026",
      title: "Sep 13 – 19",
    });
  });

  it("the backlog is just named", () => {
    expect(headerFor({ kind: "backlog" })).toEqual({ overline: "", title: "Backlog" });
  });

  it("a meeting keeps its own heading, so it gets only the line above", () => {
    const h = headerFor({ kind: "meeting", date: "2026-09-19" });
    expect(h.title).toBe("");
    expect(h.overline).toMatch(/^Meeting · .*2026/);
  });

  it("a skill shows its title and its settings", () => {
    expect(headerFor({ title: "Clean up", context: "selection", mode: "replace" })).toEqual({
      overline: "context selection · mode replace",
      title: "Clean up",
    });
  });
});

describe("in the editor", () => {
  let view: EditorView | null = null;
  afterEach(() => {
    view?.destroy();
    view = null;
  });

  function mount(cursor: number) {
    view = new EditorView({
      state: EditorState.create({
        doc: WEEK,
        selection: { anchor: cursor },
        extensions: [frontmatterExtension],
      }),
      parent: document.body,
    });
    return view;
  }

  it("draws the header while the cursor is in the note", () => {
    const v = mount(WEEK.indexOf("## Now"));
    expect(v.contentDOM.querySelector(".cm-fm-title")?.textContent).toBe("Sep 13 – 19");
    expect(v.contentDOM.querySelector(".cm-fm-overline")?.textContent).toBe("Week 38 · 2026");
    expect(v.contentDOM.textContent).not.toContain("week: 2026");
    // Nothing about the file changed.
    expect(v.state.doc.toString()).toBe(WEEK);
  });

  it("shows the raw lines once the cursor moves in, and the header again when it leaves", () => {
    const v = mount(WEEK.indexOf("## Now"));
    v.dispatch({ selection: { anchor: 6 } });
    expect(v.contentDOM.querySelector(".cm-fm")).toBeNull();
    expect(v.contentDOM.textContent).toContain("week: 2026-09-13");
    expect(v.contentDOM.querySelectorAll(".cm-fm-raw").length).toBe(4);

    v.dispatch({ selection: { anchor: WEEK.length } });
    expect(v.contentDOM.querySelector(".cm-fm-title")).not.toBeNull();
  });

  it("follows an edit to the dates", () => {
    const v = mount(WEEK.length);
    const at = WEEK.indexOf("19");
    v.dispatch({ changes: { from: at, to: at + 2, insert: "20" } });
    expect(v.contentDOM.querySelector(".cm-fm-title")?.textContent).toBe("Sep 13 – 20");
  });
});
