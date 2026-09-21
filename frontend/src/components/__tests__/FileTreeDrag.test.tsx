/**
 * Dragging a note in the tree, through the DOM.
 *
 * The rules are tested as plain functions in lib/treeDrag.test.ts. This is the part those
 * cannot reach: that a drag started on one row and dropped on another actually asks for
 * the move, and that a refused drop is refused by the browser's own mechanism.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FileTree } from "../FileTree";
import type { FileNode } from "../../backend";

const file = (path: string): FileNode =>
  ({ path, name: path.split("/").pop()!, isDir: false }) as FileNode;
const folder = (path: string, children: FileNode[]): FileNode =>
  ({ path, name: path.split("/").pop()!, isDir: true, children }) as FileNode;

const TREE: FileNode[] = [
  folder("notes", [
    folder("notes/governance", [file("notes/governance/policy.md")]),
    file("notes/alpha.md"),
    file("notes/beta.md"),
  ]),
  folder("todo", [file("todo/backlog.md")]),
];

afterEach(cleanup);

const transfer = () => ({ setData: vi.fn(), effectAllowed: "", dropEffect: "" });

function setup() {
  const onMove = vi.fn();
  render(<FileTree nodes={TREE} selected={null} onOpen={() => {}} onMove={onMove} />);
  const row = (name: string) => screen.getByText(name).closest("button")!;
  return { onMove, row };
}

describe("dragging a note", () => {
  it("onto a folder asks for the move", () => {
    const { onMove, row } = setup();
    fireEvent.dragStart(row("alpha"), { dataTransfer: transfer() });
    fireEvent.dragOver(row("governance"), { dataTransfer: transfer() });
    expect(row("governance").getAttribute("data-drop")).toBe("true");

    fireEvent.drop(row("governance"), { dataTransfer: transfer() });
    expect(onMove).toHaveBeenCalledWith("notes/alpha.md", "notes/governance/alpha.md");
    expect(row("governance").getAttribute("data-drop")).toBeNull();
  });

  it("onto a note in another folder files it beside that note", () => {
    const { onMove, row } = setup();
    fireEvent.click(row("governance")); // open it, to reach the note inside
    fireEvent.dragStart(row("alpha"), { dataTransfer: transfer() });
    fireEvent.dragOver(row("policy"), { dataTransfer: transfer() });
    // The folder lights up, not the note that happened to be under the pointer.
    expect(row("governance").getAttribute("data-drop")).toBe("true");

    fireEvent.drop(row("policy"), { dataTransfer: transfer() });
    expect(onMove).toHaveBeenCalledWith("notes/alpha.md", "notes/governance/alpha.md");
  });

  it("is refused where it would do nothing, or harm", () => {
    const { onMove, row } = setup();
    fireEvent.dragStart(row("alpha"), { dataTransfer: transfer() });

    // An unprevented dragover is how the browser is told "no drop here".
    expect(fireEvent.dragOver(row("beta"), { dataTransfer: transfer() })).toBe(true);
    expect(fireEvent.dragOver(row("todo"), { dataTransfer: transfer() })).toBe(true);
    expect(fireEvent.dragOver(row("governance"), { dataTransfer: transfer() })).toBe(false);

    fireEvent.drop(row("todo"), { dataTransfer: transfer() });
    expect(onMove).not.toHaveBeenCalled();
  });

  it("only notes outside todo can be picked up", () => {
    const { row } = setup();
    expect(row("alpha").getAttribute("draggable")).toBe("true");
    expect(row("backlog").getAttribute("draggable")).toBe("false");
    expect(row("governance").getAttribute("draggable")).toBeNull();
  });

  it("a closed folder opens under a drag that rests on it", () => {
    vi.useFakeTimers();
    const { row } = setup();
    expect(screen.queryByText("policy")).toBeNull();

    fireEvent.dragStart(row("alpha"), { dataTransfer: transfer() });
    fireEvent.dragEnter(row("governance"), { dataTransfer: transfer() });
    vi.advanceTimersByTime(700);
    vi.useRealTimers();

    // Flush React's pending state update.
    return screen.findByText("policy");
  });

  it("nothing is draggable when the tree has no move handler", () => {
    render(<FileTree nodes={TREE} selected={null} onOpen={() => {}} />);
    expect(screen.getByText("alpha").closest("button")!.getAttribute("draggable")).toBe("false");
  });
});
