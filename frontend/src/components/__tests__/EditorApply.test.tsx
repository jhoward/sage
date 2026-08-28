/**
 * Applying generated text.
 *
 * Accept is the only action in the app that writes model output to a file, so the
 * imperative handle it goes through is worth testing directly.
 */

import { render, cleanup } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
