/**
 * Collapsible sections, through a real EditorView: the fold range under a heading, the
 * chevron, the placeholder's count, the Archive starting folded, and the memory of it.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { foldedRanges } from "@codemirror/language";
import {
  foldedHeadings,
  forgetFolds,
  initialFolds,
  isFolded,
  sectionFolding,
  sectionRange,
  toggleEffect,
} from "../sections";

const LIST = `# General

## Now
- [ ] a

## Backlog

## Archive
- [x] b <!-- done:2026-10-01 -->
  - a note under b
- [x] c <!-- done:2026-09-01 -->
`;

let view: EditorView | null = null;

function mount(doc: string, path = "todo/general.md", defaults = ["## Archive"]) {
  view = new EditorView({
    state: EditorState.create({ doc, extensions: [sectionFolding(path)] }),
    parent: document.body,
  });
  const folds = initialFolds(view.state, path, defaults);
  if (folds.length) view.dispatch({ effects: folds });
  return view;
}

beforeEach(forgetFolds);
afterEach(() => {
  view?.destroy();
  view = null;
  document.body.innerHTML = "";
});

describe("what a heading folds", () => {
  const s = EditorState.create({ doc: LIST });
  const lineOf = (text: string) => {
    for (let n = 1; n <= s.doc.lines; n++) if (s.doc.line(n).text === text) return n;
    throw new Error(text);
  };

  it("from the end of the heading to the section's last non-blank line", () => {
    const r = sectionRange(s, lineOf("## Now"))!;
    expect(s.doc.sliceString(r.from, r.to)).toBe("\n- [ ] a");
    const a = sectionRange(s, lineOf("## Archive"))!;
    expect(s.doc.sliceString(a.from, a.to)).toBe(
      "\n- [x] b <!-- done:2026-10-01 -->\n  - a note under b\n- [x] c <!-- done:2026-09-01 -->",
    );
  });

  it("nothing, for an empty section or a line that is not a heading", () => {
    expect(sectionRange(s, lineOf("## Backlog"))).toBeNull();
    expect(sectionRange(s, lineOf("- [ ] a"))).toBeNull();
  });

  it("a `#` title does not fold — it is the note, not a section — but it ends one", () => {
    const t = EditorState.create({ doc: "## One\n- x\n\n# Title\n\n## Two\n### Deep\n- y\n" });
    expect(sectionRange(t, 4)).toBeNull();
    const one = sectionRange(t, 1)!;
    expect(t.doc.sliceString(one.from, one.to)).toBe("\n- x");
    const two = sectionRange(t, 6)!;
    expect(t.doc.sliceString(two.from, two.to)).toBe("\n### Deep\n- y");
  });
});

describe("in the editor", () => {
  it("a list opens with its Archive folded and the rest open", () => {
    const v = mount(LIST);
    expect(foldedHeadings(v.state)).toEqual(["## Archive"]);
    expect(isFolded(v.state, 3)).toBe(false); // ## Now
    const placeholder = v.contentDOM.querySelector(".cm-section-folded");
    expect(placeholder?.textContent).toBe("2 tasks");
    expect(v.contentDOM.textContent).not.toContain("a note under b");
  });

  it("a note opens with nothing folded", () => {
    const v = mount("# Note\n\n## Part\n- x\n", "notes/a.md", []);
    expect(foldedHeadings(v.state)).toEqual([]);
  });

  it("the chevron toggles its section, and the placeholder unfolds it", () => {
    const v = mount(LIST);
    const toggles = v.contentDOM.querySelectorAll(".cm-section-toggle");
    // Now and Archive have something under them; Backlog is empty and has no chevron.
    expect(toggles.length).toBe(2);
    expect(toggles[0].getAttribute("aria-expanded")).toBe("true");
    expect(toggles[1].getAttribute("aria-expanded")).toBe("false");

    toggles[0].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(foldedHeadings(v.state)).toEqual(["## Now", "## Archive"]);
    expect(v.contentDOM.textContent).not.toContain("- [ ] a");

    v.contentDOM.querySelectorAll<HTMLElement>(".cm-section-folded")[1].click();
    expect(foldedHeadings(v.state)).toEqual(["## Now"]);
  });

  it("remembers what was folded for the file, across opens, while the app runs", () => {
    const v = mount(LIST);
    v.dispatch({ effects: toggleEffect(v.state, 8)! }); // unfold Archive
    expect(foldedRanges(v.state).size).toBe(0);
    v.destroy();
    view = null;

    const again = mount(LIST);
    expect(foldedHeadings(again.state)).toEqual([]);

    const other = mount(LIST, "todo/house.md");
    expect(foldedHeadings(other.state)).toEqual(["## Archive"]);
  });
});
