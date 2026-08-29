import { describe, expect, it } from "vitest";
import type { FileNode } from "../../backend";
import {
  lineLinksTo,
  linkNameFor,
  parseLinks,
  resolveLink,
  slugify,
} from "../wikilinks";

const FILES: FileNode[] = [
  {
    name: "notes",
    path: "notes",
    isDir: true,
    children: [
      { name: "cloud-networking.md", path: "notes/cloud-networking.md", isDir: false },
      { name: "vpc.md", path: "notes/vpc.md", isDir: false },
    ],
  },
  {
    name: "archive",
    path: "archive",
    isDir: true,
    children: [{ name: "vpc.md", path: "archive/vpc.md", isDir: false }],
  },
  { name: "readme.md", path: "readme.md", isDir: false },
];

describe("parseLinks", () => {
  it("finds a plain link", () => {
    expect(parseLinks("see [[cloud-networking]] for more")).toEqual([
      { target: "cloud-networking", alias: undefined, from: 4, to: 24 },
    ]);
  });

  it("handles an alias", () => {
    const [link] = parseLinks("see [[cloud-networking|the networking note]]");
    expect(link.target).toBe("cloud-networking");
    expect(link.alias).toBe("the networking note");
  });

  it("finds several links on one line", () => {
    expect(parseLinks("[[a]] and [[b]]").map((l) => l.target)).toEqual(["a", "b"]);
  });

  it("ignores empty and unterminated links", () => {
    expect(parseLinks("[[]] and [[unclosed")).toEqual([]);
  });

  it("does not span lines", () => {
    expect(parseLinks("[[open\nclosed]]")).toEqual([]);
  });
});

describe("resolveLink", () => {
  it("resolves by unique basename", () => {
    expect(resolveLink("cloud-networking", FILES)).toBe("notes/cloud-networking.md");
  });

  it("resolves a full path", () => {
    expect(resolveLink("notes/vpc", FILES)).toBe("notes/vpc.md");
  });

  it("tolerates an explicit .md", () => {
    expect(resolveLink("cloud-networking.md", FILES)).toBe("notes/cloud-networking.md");
  });

  it("is case insensitive", () => {
    expect(resolveLink("Cloud-Networking", FILES)).toBe("notes/cloud-networking.md");
  });

  it("refuses an ambiguous basename rather than guessing", () => {
    // vpc.md exists in two folders; silently picking one would be worse than nothing.
    expect(resolveLink("vpc", FILES)).toBeNull();
  });

  it("returns null for an unknown note", () => {
    expect(resolveLink("nope", FILES)).toBeNull();
  });
});

describe("lineLinksTo", () => {
  it("confirms a real link", () => {
    expect(
      lineLinksTo("see [[cloud-networking]]", "notes/cloud-networking.md", FILES),
    ).toBe(true);
  });

  it("rejects a prefix collision", () => {
    // A literal search for "[[cloud" would surface this line; parsing rules it out.
    expect(
      lineLinksTo("see [[cloud-networking-old]]", "notes/cloud-networking.md", FILES),
    ).toBe(false);
  });
});

describe("linkNameFor", () => {
  it("strips folder and extension", () => {
    expect(linkNameFor("notes/cloud-networking.md")).toBe("cloud-networking");
  });
});

describe("slugify", () => {
  it("turns a name into a filename", () => {
    expect(slugify("Cross-cloud networking")).toBe("Cross-cloud-networking");
  });

  it("strips characters that are awkward in a filename, but keeps slashes", () => {
    // Slashes are meaningful now — they make folders. Everything else is collapsed.
    expect(slugify('a/b:c*d?e"f<g>h|i')).toBe("a/b-c-d-e-f-g-h-i");
  });

  it("collapses runs and trims edges", () => {
    expect(slugify("  hello   world  ")).toBe("hello-world");
    expect(slugify("--x--")).toBe("x");
  });

  it("keeps unicode letters — notes are personal, not URLs", () => {
    expect(slugify("Café résumé")).toBe("Café-résumé");
  });

  it("drops a trailing .md", () => {
    expect(slugify("notes.md")).toBe("notes");
  });

  it("returns empty for a name with nothing usable", () => {
    expect(slugify("   ")).toBe("");
  });
});

describe("slugify with paths", () => {
  it("keeps slashes so a folder can be made by naming one", () => {
    expect(slugify("governance/vendor risk")).toBe("governance/vendor-risk");
  });

  it("slugifies each segment independently", () => {
    expect(slugify("Q4 Planning/Scope & budget")).toBe("Q4-Planning/Scope-&-budget");
  });

  it("drops empty segments rather than leaving a double slash", () => {
    expect(slugify("a//b")).toBe("a/b");
    expect(slugify("/leading")).toBe("leading");
    expect(slugify("trailing/")).toBe("trailing");
  });

  it("still handles a plain name", () => {
    expect(slugify("Cross-cloud networking")).toBe("Cross-cloud-networking");
  });

  it("drops dot segments so a path cannot climb", () => {
    expect(slugify("../secrets")).toBe("secrets");
    expect(slugify("a/../../b")).toBe("a/b");
    expect(slugify("./notes")).toBe("notes");
  });
});
