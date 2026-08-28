/**
 * Wiring tests.
 *
 * The accept button silently did nothing for a while because `ref={editor}` was missing
 * from the <Editor> element in App. Every existing test passed: they exercised Editor in
 * isolation, where the ref is passed by the test itself. Nothing checked that App actually
 * connects the two.
 *
 * These assert on the composition rather than the components.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const app = readFileSync(join(__dirname, "../../App.tsx"), "utf8");

describe("App wires the editor handle", () => {
  it("passes the ref to the primary Editor", () => {
    // Without this, acceptRun cannot reach apply() and accept does nothing.
    expect(app).toMatch(/ref=\{editor\}/);
  });

  it("declares the ref it passes", () => {
    expect(app).toMatch(/const editor = useRef<EditorHandle>\(null\)/);
  });

  it("passes onCreateLink so unresolved [[links]] can be created", () => {
    expect(app).toMatch(/onCreateLink=\{/);
  });

  it("does not fail silently when the editor is missing", () => {
    // A bare `if (!editor.current) return` is what made the bug invisible.
    const accept = app.slice(app.indexOf("const acceptRun"), app.indexOf("const rejectRun"));
    expect(accept).toMatch(/setError/);
  });
});

describe("App wires every global binding it defines", () => {
  const bindings = readFileSync(
    join(__dirname, "../../lib/keybindings.ts"),
    "utf8",
  );

  it("handles each name in BINDINGS", () => {
    const names = [...bindings.matchAll(/^\s{2}(\w+): \{ key:/gm)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(3);
    for (const name of names) {
      expect(app).toContain(`BINDINGS.${name}`);
    }
  });
});
