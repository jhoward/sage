/**
 * The Ctrl-is-not-Cmd rule.
 *
 * A previous version used `metaKey || ctrlKey`, which meant ⌃K opened the command palette
 * on macOS instead of killing to end of line, and ⌃N created a note instead of moving down
 * a line. These tests exist so that never comes back.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BINDINGS, label, matches, type KeySpec } from "../keybindings";

function ev(key: string, mods: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  } as KeyboardEvent;
}

/** isMac() is checked lazily, so stubbing the platform is enough — no module reset. */
function underPlatform(platform: string) {
  vi.stubGlobal("navigator", { platform });
}

afterEach(() => vi.unstubAllGlobals());

describe("on macOS", () => {
  beforeEach(() => underPlatform("MacIntel"));

  it("matches Cmd-K", () => {
    expect(matches(ev("k", { metaKey: true }), BINDINGS.palette)).toBe(true);
  });

  it("does NOT match Ctrl-K — that is kill-to-end-of-line", () => {
    expect(matches(ev("k", { ctrlKey: true }), BINDINGS.palette)).toBe(false);
  });

  it("leaves every readline binding alone", () => {
    for (const key of ["a", "e", "k", "n", "p", "d", "f", "b", "w", "u", "y", "t", "o"]) {
      for (const binding of Object.values(BINDINGS)) {
        expect(matches(ev(key, { ctrlKey: true }), binding)).toBe(false);
      }
    }
  });

  it("labels with glyphs", () => {
    expect(label(BINDINGS.search)).toBe("⌘⇧F");
  });
});

describe("on Linux and Windows", () => {
  beforeEach(() => underPlatform("Linux x86_64"));

  it("matches Ctrl-K, where Mod means Ctrl", () => {
    expect(matches(ev("k", { ctrlKey: true }), BINDINGS.palette)).toBe(true);
  });

  it("does not match Cmd-K", () => {
    expect(matches(ev("k", { metaKey: true }), BINDINGS.palette)).toBe(false);
  });

  it("labels in words", () => {
    expect(label(BINDINGS.search)).toBe("Ctrl+Shift+F");
  });
});

describe("modifier precision", () => {
  beforeEach(() => underPlatform("MacIntel"));
  const spec: KeySpec = { key: "f", mod: true, shift: true };

  it("requires shift when the spec asks for it", () => {
    expect(matches(ev("f", { metaKey: true }), spec)).toBe(false);
  });

  it("rejects an unwanted shift", () => {
    expect(matches(ev("k", { metaKey: true, shiftKey: true }), BINDINGS.palette)).toBe(
      false,
    );
  });

  it("rejects an unwanted alt", () => {
    expect(matches(ev("k", { metaKey: true, altKey: true }), BINDINGS.palette)).toBe(
      false,
    );
  });

  it("is case insensitive on the key", () => {
    expect(matches(ev("K", { metaKey: true }), BINDINGS.palette)).toBe(true);
  });

  it("distinguishes bindings that differ only by shift", () => {
    expect(matches(ev("f", { metaKey: true, shiftKey: true }), BINDINGS.search)).toBe(true);
    expect(matches(ev("f", { metaKey: true }), BINDINGS.search)).toBe(false);
  });
});

describe("the tiering rule", () => {
  beforeEach(() => underPlatform("MacIntel"));

  const CORE = ["palette", "switcher", "ask", "newNote", "quickAdd", "startMeeting", "split"];

  it("core commands are unshifted", () => {
    for (const name of CORE) {
      const spec: KeySpec = BINDINGS[name as keyof typeof BINDINGS];
      expect(spec.mod, name).toBe(true);
      expect(spec.shift, name).toBeFalsy();
    }
  });

  it("everything else takes shift", () => {
    for (const [name, spec] of Object.entries<KeySpec>(BINDINGS)) {
      if (CORE.includes(name) || name === "deleteNote") continue;
      expect(spec.shift, name).toBe(true);
    }
  });

  it("the three new-verbs are siblings", () => {
    // A peer promoted while its peers are not is the inconsistency this rule exists for.
    expect(label(BINDINGS.newNote)).toBe("⌘N");
    expect(label(BINDINGS.quickAdd)).toBe("⌘T");
    expect(label(BINDINGS.startMeeting)).toBe("⌘M");
  });

  it("no two bindings collide", () => {
    const seen = new Map<string, string>();
    for (const [name, spec] of Object.entries<KeySpec>(BINDINGS)) {
      const key = label(spec);
      expect(seen.get(key), `${name} collides with ${seen.get(key)}`).toBeUndefined();
      seen.set(key, name);
    }
  });
});
