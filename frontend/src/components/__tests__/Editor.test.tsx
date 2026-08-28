/**
 * Regression tests for cross-file save corruption.
 *
 * The original bug: React runs an effect's cleanup *after* re-rendering with the new
 * props, so a flush that read `path` from props at cleanup time wrote the outgoing
 * document into the incoming file — silently destroying it. Switching from backlog to
 * the week file overwrote the week with the backlog's contents.
 *
 * Each editor instance must save only to the file it was opened with.
 */

import { render, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "../Editor";

afterEach(cleanup);

const WEEK = "## Inbox\n- [ ] Ship the vault layer\n";
const BACKLOG = "## General\n- [ ] Look into caching\n";

describe("Editor file switching", () => {
  it("never saves one file's content into another", () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <Editor path="todo/backlog.md" content={BACKLOG} onSave={onSave} />,
    );

    rerender(<Editor path="todo/2026-W35.md" content={WEEK} onSave={onSave} />);

    for (const [savedPath, savedContent] of onSave.mock.calls) {
      if (savedPath === "todo/2026-W35.md") {
        expect(savedContent).not.toContain("Look into caching");
      }
      if (savedPath === "todo/backlog.md") {
        expect(savedContent).not.toContain("Ship the vault layer");
      }
    }
  });

  it("does not write on a clean switch", () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <Editor path="todo/backlog.md" content={BACKLOG} onSave={onSave} />,
    );
    rerender(<Editor path="todo/2026-W35.md" content={WEEK} onSave={onSave} />);

    // Nothing was edited, so nothing should have been saved.
    expect(onSave).not.toHaveBeenCalled();
  });

  it("does not write on unmount when untouched", () => {
    const onSave = vi.fn();
    const { unmount } = render(
      <Editor path="todo/backlog.md" content={BACKLOG} onSave={onSave} />,
    );
    unmount();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("reopening the same file twice does not clobber it", () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <Editor path="todo/backlog.md" content={BACKLOG} onSave={onSave} />,
    );
    // Double-click: the same path opens again.
    rerender(<Editor path="todo/backlog.md" content={BACKLOG} onSave={onSave} />);

    for (const [, savedContent] of onSave.mock.calls) {
      expect(savedContent).toContain("Look into caching");
    }
  });
});
