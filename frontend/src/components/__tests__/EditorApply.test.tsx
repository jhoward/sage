/**
 * Applying generated text.
 *
 * Accept is the only action in the app that writes model output to a file, so the
 * imperative handle it goes through is worth testing directly.
 */

import { render, cleanup } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AIReview } from "../AIReview";
import { Editor, type EditorHandle } from "../Editor";

afterEach(cleanup);

function mount(content: string) {
  const ref = createRef<EditorHandle>();
  const onSave = vi.fn();
  render(<Editor ref={ref} path="notes/a.md" content={content} onSave={onSave} />);
  return { ref, onSave };
}

describe("EditorHandle", () => {
  it("is populated once mounted", () => {
    const { ref } = mount("hello");
    expect(ref.current).not.toBeNull();
    expect(typeof ref.current?.apply).toBe("function");
  });

  it("appends", () => {
    const { ref, onSave } = mount("original");
    ref.current!.apply("added", "append");
    ref.current!.apply("", "append"); // no-op second call to flush nothing
    expect(onSave).not.toHaveBeenCalled(); // debounced, not immediate
  });

  it("replaces the whole document when there is no selection", () => {
    const { ref } = mount("original text");
    ref.current!.apply("replacement", "replace");
    expect(ref.current!.selection()).toBe("");
  });

  it("survives the panel taking focus before accept", () => {
    // Accept is clicked from a panel outside the editor, so the editor is not focused
    // when apply() runs. It must still work.
    const { ref } = mount("original");
    (document.activeElement as HTMLElement | null)?.blur();
    expect(() => ref.current!.apply("text", "replace")).not.toThrow();
  });
});

describe("AIReview accept", () => {
  const skill = {
    id: "expand",
    title: "Expand",
    context: "note" as const,
    mode: "replace" as const,
    path: ".occam/skills/expand.md",
  };

  function panel(props: Partial<{ streaming: boolean; text: string }> = {}) {
    return (
      <AIReview
        skill={skill}
        text={props.text ?? "generated text"}
        streaming={props.streaming ?? false}
        error={null}
        onAccept={() => {}}
        onReject={() => {}}
      />
    );
  }

  it("focuses Accept once generation finishes, so plain Enter works", () => {
    // Without focus the panel never received keys: Enter went to the editor and inserted
    // a newline, and only Cmd-Enter worked through a window listener.
    const { getByText } = render(panel());
    expect(document.activeElement).toBe(getByText("Accept"));
  });

  it("does not steal focus while still streaming", () => {
    render(panel({ streaming: true, text: "partial" }));
    expect(document.activeElement).toBe(document.body);
  });
});

describe("AIReview does not capture keys when idle", () => {
  it("leaves Cmd-Enter alone with no skill in flight", () => {
    // Hooks run before the component's early return, so an unguarded listener stayed
    // installed and swallowed ⌘Enter — completing a task stopped working everywhere.
    render(
      <AIReview
        skill={null}
        text=""
        streaming={false}
        error={null}
        onAccept={() => {}}
        onReject={() => {}}
      />,
    );

    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      metaKey: true,
      cancelable: true,
      bubbles: true,
    });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("leaves Escape alone with no skill in flight", () => {
    const onReject = vi.fn();
    render(
      <AIReview
        skill={null}
        text=""
        streaming={false}
        error={null}
        onAccept={() => {}}
        onReject={onReject}
      />,
    );

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true }),
    );
    expect(onReject).not.toHaveBeenCalled();
  });
});
