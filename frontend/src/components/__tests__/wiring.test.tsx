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

  it("has an action for every name in BINDINGS", () => {
    // The key handler walks this table, so a command listed in keybindings.ts but missing
    // here can be bound in the settings file and then silently do nothing.
    const names = [...bindings.matchAll(/^\s{2}(\w+): \{ key:/gm)].map((m) => m[1]);
    const table = app.slice(app.indexOf("const actions = useMemo"), app.indexOf("useEffect(() => {\n    const onKey"));

    expect(names.length).toBeGreaterThan(10);
    for (const name of names) {
      expect(table, name).toMatch(new RegExp(`\\b${name}:`));
    }
  });

  it("never reads a binding directly, which would bypass overrides", () => {
    expect(app).not.toMatch(/BINDINGS\.\w+/);
  });
});

describe("split panes are symmetric", () => {
  it("renders both filenames through the same component", () => {
    // The left name used to live in an outer header spanning both panes, so it sat a row
    // above the right one. One component for both is what keeps them level.
    const headers = app.match(/<PaneHeader\b/g) ?? [];
    expect(headers).toHaveLength(2);
  });

  it("has no outer header competing with the pane headers", () => {
    expect(app).not.toMatch(/<header\b/);
  });
});

describe("renaming is reachable without knowing a command", () => {
  const tree = readFileSync(join(__dirname, "../FileTree.tsx"), "utf8");

  it("double-click edits the name in place", () => {
    // The point is that nobody has to discover a rename command: you edit the name where
    // you can see it, which is the gesture Finder and every file tree already taught.
    expect(tree).toMatch(/onDoubleClick=\{\(\) => setEditing\(true\)\}/);
    expect(tree).toContain("NameInput");
  });

  it("applies to folders as well as notes", () => {
    expect(tree.match(/onDoubleClick/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("commits on Enter and on blur, cancels on Escape", () => {
    expect(tree).toMatch(/onBlur=\{commit\}/);
    expect(tree).toMatch(/e\.key === "Enter"/);
    expect(tree).toMatch(/e\.key === "Escape"/);
  });

  it("does not let the editor's keymap see the typing", () => {
    // Without stopPropagation the app's global shortcuts would fire while renaming.
    expect(tree).toContain("e.stopPropagation()");
  });

  it("App handles the rename callback", () => {
    expect(app).toMatch(/onRename=\{/);
  });
});
