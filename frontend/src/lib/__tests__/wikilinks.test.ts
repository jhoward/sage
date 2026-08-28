import { describe, expect, it } from "vitest";
import type { FileNode } from "../../backend";
import {
  lineLinksTo,
  linkNameFor,
  parseLinks,
  resolveLink,
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
