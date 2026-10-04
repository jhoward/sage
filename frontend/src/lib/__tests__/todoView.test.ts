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
import { setClock, todoExtension } from "../todo";
import { applyOverrides, isMac } from "../keybindings";

setClock(() => "2026-10-04");

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
    expect(v.state.doc.toString()).toBe("- [x] Buy milk <!-- done:2026-10-04 -->");
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
    expect(v.state.doc.toString()).toBe("- [x] Buy milk <!-- done:2026-10-04 -->");
  });
});

describe("the done stamp", () => {
  it("is drawn as a date when the cursor is elsewhere, and raw when it is on the line", () => {
    const v = mount("- [x] Shipped <!-- done:2026-10-01 -->\nnext", 42);
    const date = v.contentDOM.querySelector(".cm-task-date");
    expect(date?.textContent).toBe("Oct 1");
    expect(v.contentDOM.textContent).not.toContain("<!--");

    v.dispatch({ selection: { anchor: 3 } });
    expect(v.contentDOM.querySelector(".cm-task-date")).toBeNull();
    expect(v.contentDOM.textContent).toContain("<!-- done:2026-10-01 -->");
  });

  it("hides other metadata on an open task altogether", () => {
    const v = mount("- [ ] Old <!-- rolled:3 -->\nnext", 32);
    expect(v.contentDOM.textContent).not.toContain("rolled");
    expect(v.contentDOM.querySelector(".cm-task-date")).toBeNull();
  });

  it("names the year once it is not this one", () => {
    const v = mount("- [x] Shipped <!-- done:2025-12-24 -->\nnext", 42);
    expect(v.contentDOM.querySelector(".cm-task-date")?.textContent).toBe("Dec 24, 2025");
  });
});
