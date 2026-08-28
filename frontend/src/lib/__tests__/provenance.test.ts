/**
 * Provenance markers must survive a round trip through any other editor — that is the
 * whole reason they are HTML comments rather than a custom syntax.
 */

import { describe, expect, it } from "vitest";
import { isCloseMarker, isOpenMarker, parseMarker, strip, wrap } from "../provenance";

const P = { model: "claude-opus-5", skill: "expand", at: "2026-08-28T09:15" };

describe("wrap", () => {
  it("brackets the text with markers", () => {
    const out = wrap("Generated prose.", P);
    expect(out.split("\n")).toEqual([
      "<!-- sage:ai model=claude-opus-5 skill=expand at=2026-08-28T09:15 -->",
      "Generated prose.",
      "<!-- /sage:ai -->",
    ]);
  });

  it("trims so accepting twice does not accumulate blank lines", () => {
    expect(wrap("\n\n  text  \n\n", P)).toContain("\ntext\n");
  });
});

describe("parseMarker", () => {
  it("reads the attributes back out", () => {
    expect(parseMarker(wrap("x", P).split("\n")[0])).toEqual(P);
  });

  it("round-trips through wrap", () => {
    const line = wrap("body", P).split("\n")[0];
    expect(parseMarker(line)).toEqual(P);
  });

  it("returns null for ordinary text", () => {
    expect(parseMarker("just a line of notes")).toBeNull();
    expect(parseMarker("<!-- an unrelated comment -->")).toBeNull();
  });

  it("tolerates missing attributes rather than throwing", () => {
    expect(parseMarker("<!-- sage:ai -->")).toEqual({
      model: "unknown",
      skill: "unknown",
      at: "",
    });
  });
});

describe("marker detection", () => {
  it("recognises both ends", () => {
    const [open, , close] = wrap("body", P).split("\n");
    expect(isOpenMarker(open)).toBe(true);
    expect(isCloseMarker(close)).toBe(true);
  });

  it("does not confuse one end for the other", () => {
    const [open, , close] = wrap("body", P).split("\n");
    expect(isCloseMarker(open)).toBe(false);
    expect(isOpenMarker(close)).toBe(false);
  });
});

describe("strip", () => {
  it("leaves only the prose", () => {
    expect(strip(wrap("Generated prose.", P))).toBe("Generated prose.");
  });

  it("keeps surrounding note content intact", () => {
    const doc = `Before\n${wrap("Middle", P)}\nAfter`;
    expect(strip(doc)).toBe("Before\nMiddle\nAfter");
  });
});
