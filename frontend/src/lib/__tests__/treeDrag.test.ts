import { describe, expect, it } from "vitest";
import { canDrag, dropFolder, moveTarget } from "../treeDrag";

const note = (path: string) => ({ path, isDir: false });
const dir = (path: string) => ({ path, isDir: true });

describe("what can be dragged", () => {
  it("notes can", () => {
    expect(canDrag(note("notes/a.md"))).toBe(true);
    expect(canDrag(note("meetings/2026/standup.md"))).toBe(true);
  });

  it("folders cannot, which is what keeps the tree shallow", () => {
    expect(canDrag(dir("notes/governance"))).toBe(false);
  });

  it("week files and settings cannot: the app finds them by path", () => {
    expect(canDrag(note("todo/2026-09-20.md"))).toBe(false);
    expect(canDrag(note("todo/backlog.md"))).toBe(false);
    expect(canDrag(note(".occam/skills/cleanup.md"))).toBe(false);
  });
});

describe("where a drop lands", () => {
  it("on a folder, in that folder", () => {
    expect(moveTarget("notes/a.md", dir("notes/governance"))).toBe("notes/governance/a.md");
  });

  it("on a note, beside that note", () => {
    expect(dropFolder(note("notes/governance/b.md"))).toBe("notes/governance");
    expect(moveTarget("notes/a.md", note("notes/governance/b.md"))).toBe("notes/governance/a.md");
  });

  it("back out of a subfolder", () => {
    expect(moveTarget("notes/governance/a.md", dir("notes"))).toBe("notes/a.md");
    expect(moveTarget("notes/governance/a.md", note("notes/b.md"))).toBe("notes/a.md");
  });

  it("across top-level folders", () => {
    expect(moveTarget("notes/a.md", dir("archive"))).toBe("archive/a.md");
  });

  it("nowhere, if it is already there", () => {
    expect(moveTarget("notes/a.md", dir("notes"))).toBeNull();
    expect(moveTarget("notes/a.md", note("notes/b.md"))).toBeNull();
    expect(moveTarget("notes/a.md", note("notes/a.md"))).toBeNull();
  });

  it("never into todo or settings", () => {
    expect(moveTarget("notes/a.md", dir("todo"))).toBeNull();
    expect(moveTarget("notes/a.md", note("todo/backlog.md"))).toBeNull();
    expect(moveTarget("notes/a.md", dir(".occam/skills"))).toBeNull();
  });

  it("never to the vault root, where there is no folder row to aim at", () => {
    expect(moveTarget("notes/a.md", note("loose.md"))).toBeNull();
  });
});
