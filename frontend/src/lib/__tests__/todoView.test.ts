/**
 * The todo extension through a real EditorView.
 *
 * The command tests drive functions directly, which proves the edits and says nothing
 * about whether a key or a click ever reaches them. These go through the DOM.
 */

import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap } from "@codemirror/commands";
import { todoExtension } from "../todo";
import { applyOverrides, isMac } from "../keybindings";

let view: EditorView | null = null;

function mount(doc: string, cursor: number) {
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: cursor },
      // The default keymap is here on purpose: it binds ⌘⏎ to "insert blank line", and
      // ours has to win against it.
      extensions: [todoExtension(), keymap.of(defaultKeymap)],
    }),
    parent: document.body,
  });
  return view;
}

function press(v: EditorView, key: string, mods: { shift?: boolean; mod?: boolean } = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    shiftKey: !!mods.shift,
    metaKey: !!mods.mod && isMac(),
    ctrlKey: !!mods.mod && !isMac(),
    bubbles: true,
    cancelable: true,
  });
  v.contentDOM.dispatchEvent(event);
  return event;
}

afterEach(() => {
  view?.destroy();
  view = null;
  applyOverrides({});
});

describe("task keys reach the editor", () => {
  it("mod-Enter makes a task, then checks it off", () => {
    const v = mount("Buy milk", 8);
    const event = press(v, "Enter", { mod: true });
    expect(v.state.doc.toString()).toBe("- [ ] Buy milk");
    expect(event.defaultPrevented).toBe(true);

    press(v, "Enter", { mod: true });
    expect(v.state.doc.toString()).toBe("- [x] Buy milk");
  });

  it("shift-mod-Enter takes the box away again", () => {
    const v = mount("1. [ ] Buy milk", 15);
    press(v, "Enter", { mod: true, shift: true });
    expect(v.state.doc.toString()).toBe("1. Buy milk");
  });

  it("follows an override loaded after the editor was built", () => {
    const v = mount("Buy milk", 8);
    applyOverrides({ toggleTask: { key: "d", mod: true, shift: true } });

    press(v, "d", { mod: true, shift: true });
    expect(v.state.doc.toString()).toBe("- [ ] Buy milk");
  });
});

describe("the drawn checkbox", () => {
  it("replaces the raw box when the cursor is elsewhere on the line", () => {
    const v = mount("- [ ] Buy milk\n1. [x] Done", 14);
    const drawn = v.contentDOM.querySelectorAll(".cm-task-checkbox");
    expect(drawn.length).toBe(2);
    expect(drawn[0].getAttribute("aria-checked")).toBe("false");
    expect(drawn[1].getAttribute("aria-checked")).toBe("true");
    // The bullet goes with its box; the number stays beside it.
    expect(v.contentDOM.textContent).not.toContain("- ");
    expect(v.contentDOM.textContent).toContain("1. ");
  });

  it("shows the raw markdown when the cursor is on it", () => {
    const v = mount("- [ ] Buy milk", 3);
    expect(v.contentDOM.querySelector(".cm-task-checkbox")).toBeNull();
    expect(v.contentDOM.textContent).toContain("- [ ]");
  });

  it("toggles on click", () => {
    const v = mount("- [ ] Buy milk", 14);
    const drawn = v.contentDOM.querySelector(".cm-task-checkbox")!;
    drawn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(v.state.doc.toString()).toBe("- [x] Buy milk");
  });
});
