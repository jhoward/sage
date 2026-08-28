/**
 * Palette matching.
 *
 * The registry is data, not a switch statement, so that Phase 3 skills can join the same
 * list. These tests pin the ranking behaviour the palette depends on.
 */

import { describe, expect, it } from "vitest";
import { filterCommands, score, type Command } from "../commands";

const cmd = (id: string, title: string, keywords?: string): Command => ({
  id,
  title,
  keywords,
  run: () => {},
});

const COMMANDS = [
  cmd("week", "Open this week", "todo current"),
  cmd("rollover", "Roll unfinished work into this week", "new week carry forward"),
  cmd("send", "Send this task to the backlog", "move defer"),
  cmd("backlog", "Open backlog", "todo someday"),
  cmd("note", "Open cloud-networking", "notes/cloud-networking.md"),
];

describe("score", () => {
  it("returns 0 for an empty query so everything shows", () => {
    expect(score("", COMMANDS[0])).toBe(0);
  });

  it("ranks an earlier substring hit better", () => {
    const early = score("open", cmd("a", "Open backlog"))!;
    const late = score("backlog", cmd("b", "Open backlog"))!;
    expect(early).toBeLessThan(late);
  });

  it("matches a scattered subsequence", () => {
    expect(score("stb", cmd("s", "Send this task to the backlog"))).not.toBeNull();
  });

  it("ranks every subsequence match below every contiguous one", () => {
    const contiguous = score("task", cmd("s", "Send this task to the backlog"))!;
    const scattered = score("stb", cmd("s", "Send this task to the backlog"))!;
    expect(contiguous).toBeLessThan(scattered);
  });

  it("returns null when a character is missing", () => {
    expect(score("zzz", COMMANDS[0])).toBeNull();
  });

  it("searches keywords as well as the title", () => {
    expect(score("someday", cmd("b", "Open backlog", "todo someday"))).not.toBeNull();
  });

  it("is case insensitive", () => {
    expect(score("OPEN BACKLOG", cmd("b", "Open backlog"))).not.toBeNull();
  });
});

describe("rank", () => {
  it("orders equal matches by rank", () => {
    const items: Command[] = [
      { id: "old", title: "Open alpha", rank: 5, run: () => {} },
      { id: "recent", title: "Open beta", rank: 0, run: () => {} },
    ];
    expect(filterCommands("open", items).map((c) => c.id)).toEqual(["recent", "old"]);
  });

  it("does not let rank override a better text match", () => {
    const items: Command[] = [
      { id: "recent", title: "Zebra notes", rank: 0, run: () => {} },
      { id: "exact", title: "Alpha", rank: 9, run: () => {} },
    ];
    expect(filterCommands("alpha", items)[0].id).toBe("exact");
  });

  it("treats a missing rank as zero", () => {
    const items: Command[] = [
      { id: "ranked", title: "Open x", rank: 3, run: () => {} },
      { id: "unranked", title: "Open y", run: () => {} },
    ];
    expect(filterCommands("open", items)[0].id).toBe("unranked");
  });
});

describe("filterCommands", () => {
  it("returns everything for an empty query", () => {
    expect(filterCommands("", COMMANDS)).toHaveLength(COMMANDS.length);
  });

  it("puts the best match first", () => {
    // "Open backlog" beats "Send this task to the backlog": the hit is earlier in the
    // title, which is what makes short queries land on the short command.
    expect(filterCommands("backlog", COMMANDS)[0].id).toBe("backlog");
    expect(filterCommands("send", COMMANDS)[0].id).toBe("send");
    expect(filterCommands("roll", COMMANDS)[0].id).toBe("rollover");
  });

  it("finds a note by its path", () => {
    expect(filterCommands("cloud-net", COMMANDS)[0].id).toBe("note");
  });

  it("drops non-matches entirely", () => {
    expect(filterCommands("qqqq", COMMANDS)).toEqual([]);
  });
});
