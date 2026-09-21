import { describe, expect, it } from "vitest";
import { KEYS_SHEET, MARKDOWN_SHEET, toggleSheet } from "../sheets";

describe("a reference sheet toggles", () => {
  it("opens into an empty pane, and closes it again", () => {
    const opened = toggleSheet(null, KEYS_SHEET, null);
    expect(opened).toEqual({ show: KEYS_SHEET, remember: null });

    expect(toggleSheet(KEYS_SHEET, KEYS_SHEET, opened.remember)).toEqual({
      show: null,
      remember: null,
    });
  });

  it("gives the pane back to what was there", () => {
    const opened = toggleSheet("todo/backlog.md", KEYS_SHEET, null);
    expect(opened).toEqual({ show: KEYS_SHEET, remember: "todo/backlog.md" });

    expect(toggleSheet(KEYS_SHEET, KEYS_SHEET, opened.remember).show).toBe("todo/backlog.md");
  });

  it("going from one sheet to the other still returns to your own work", () => {
    const keys = toggleSheet("todo/backlog.md", KEYS_SHEET, null);
    const markdown = toggleSheet(KEYS_SHEET, MARKDOWN_SHEET, keys.remember);
    expect(markdown).toEqual({ show: MARKDOWN_SHEET, remember: "todo/backlog.md" });

    expect(toggleSheet(MARKDOWN_SHEET, MARKDOWN_SHEET, markdown.remember).show).toBe(
      "todo/backlog.md",
    );
  });

  it("forgets what it remembered once it has been used", () => {
    expect(toggleSheet(KEYS_SHEET, KEYS_SHEET, "todo/backlog.md").remember).toBeNull();
  });
});
