import { describe, expect, it } from "vitest";
import { describeSync } from "../SyncIndicator";
import type { SyncStatus } from "../../backend";

const git = (state: SyncStatus["state"], detail = "", conflicts: string[] = []): SyncStatus => ({
  backend: "git",
  state,
  detail,
  conflicts,
});

describe("what the backup dot says", () => {
  it("grey means off, never fine", () => {
    const off = describeSync({ backend: "local", state: "ok", detail: "", conflicts: [] });
    expect(off.tone).toBe("off");
    expect(off.word).toBe("backup off");
  });

  it("green is nothing waiting", () => {
    expect(describeSync(git("ok"))).toMatchObject({ tone: "good", word: "synced" });
  });

  it("green without a remote does not claim an offsite copy", () => {
    const local = describeSync(git("ok", "local history only"));
    expect(local).toMatchObject({ tone: "good", word: "saved" });
    expect(local.title).toMatch(/this Mac only/);
  });

  it("yellow is whatever will pass by itself", () => {
    for (const state of ["pending", "syncing", "offline"] as const) {
      expect(describeSync(git(state)).tone, state).toBe("waiting");
    }
  });

  it("red is what still needs you tomorrow", () => {
    expect(describeSync(git("error", "Permission denied (publickey).")).tone).toBe("bad");
    const conflict = describeSync(git("conflict", "", ["notes/a.md"]));
    expect(conflict.tone).toBe("bad");
    expect(conflict.title).toContain("notes/a.md");
  });

  it("carries the backend's reason for a failure into the tooltip", () => {
    expect(describeSync(git("error", "ERROR: Repository not found.")).title).toContain(
      "Repository not found",
    );
  });
});
