/**
 * Dragging a note in the tree, through the DOM.
 *
 * The rules are tested as plain functions in lib/treeDrag.test.ts. This is the part those
 * cannot reach: that a drag started on one row and dropped on another actually asks for
 * the move, and that a refused drop is refused by the browser's own mechanism.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FileTree, PinnedList } from "../FileTree";
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
  folder("todo", [file("todo/general.md")]),
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

  it("notes can be picked up, folders cannot", () => {
    const { row } = setup();
    expect(row("alpha").getAttribute("draggable")).toBe("true");
    // A list drags too — it cannot be moved, but it can be pinned.
    expect(row("general").getAttribute("draggable")).toBe("true");
    expect(row("governance").getAttribute("draggable")).toBeNull();
  });

  it("a list dragged onto a folder is refused", () => {
    const { onMove, row } = setup();
    fireEvent.dragStart(row("general"), { dataTransfer: transfer() });
    expect(fireEvent.dragOver(row("governance"), { dataTransfer: transfer() })).toBe(true);
    fireEvent.drop(row("governance"), { dataTransfer: transfer() });
    expect(onMove).not.toHaveBeenCalled();
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

describe("the pinned area", () => {
  it("is not there with nothing pinned, until a drag begins", () => {
    const onPin = vi.fn();
    render(
      <>
        <PinnedList pins={[]} selected={null} onOpen={() => {}} onReorder={onPin} />
        <FileTree nodes={TREE} selected={null} onOpen={() => {}} onMove={() => {}} />
      </>,
    );
    expect(screen.queryByText("Drop to pin")).toBeNull();

    const row = screen.getByText("alpha").closest("button")!;
    fireEvent.dragStart(row, { dataTransfer: transfer() });
    const zone = screen.getByText("Drop to pin").parentElement!;
    expect(fireEvent.dragOver(zone, { dataTransfer: transfer() })).toBe(false);
    fireEvent.drop(zone, { dataTransfer: transfer() });
    expect(onPin).toHaveBeenCalledWith(["notes/alpha.md"]);
  });

  it("lists what is pinned, by title; a note already there can only be moved", () => {
    const onPin = vi.fn();
    const onOpen = vi.fn();
    render(
      <>
        <PinnedList
          pins={[{ path: "todo/general.md", title: "General" }]}
          selected={null}
          onOpen={onOpen}
          onReorder={onPin}
        />
        <FileTree nodes={TREE} selected={null} onOpen={() => {}} onMove={() => {}} />
      </>,
    );
    fireEvent.click(screen.getByText("General"));
    expect(onOpen).toHaveBeenCalledWith("todo/general.md");

    // The same list, picked up in the tree, dropped at the end of the pins: it is
    // already last, so nothing changes and nothing is reported.
    const list = screen.getByText("general").closest("button")!;
    fireEvent.dragStart(list, { dataTransfer: transfer() });
    const zone = screen.getByText("General").closest(".side-pins")!;
    fireEvent.drop(zone, { dataTransfer: transfer() });
    expect(onPin).not.toHaveBeenCalled();
  });
});

describe("what a row is called", () => {
  it("is the note's title when it has one, else the file name — as the pinned rows do", () => {
    const nodes: FileNode[] = [
      folder("todo", [
        { ...file("todo/aise-class.md"), title: "AISE Class" },
        file("todo/house.md"),
      ]),
    ];
    render(<FileTree nodes={nodes} selected={null} onOpen={() => {}} />);
    expect(screen.getByText("AISE Class")).toBeTruthy();
    expect(screen.queryByText("aise-class")).toBeNull();
    expect(screen.getByText("house")).toBeTruthy();
  });
});

describe("reordering pins", () => {
  const PINS = [
    { path: "todo/a.md", title: "A" },
    { path: "todo/b.md", title: "B" },
    { path: "todo/c.md", title: "C" },
  ];

  function setupPins() {
    const onReorder = vi.fn();
    render(
      <>
        <PinnedList pins={PINS} selected={null} onOpen={() => {}} onReorder={onReorder} />
        <FileTree nodes={TREE} selected={null} onOpen={() => {}} onMove={() => {}} />
      </>,
    );
    const row = (name: string) => screen.getByText(name).closest("button")!;
    return { onReorder, row };
  }

  it("drags a pin below another and reports the new order", () => {
    const { onReorder, row } = setupPins();
    fireEvent.dragStart(row("A"), { dataTransfer: transfer() });
    // jsdom lays nothing out and drops clientY on the floor, so the row is placed above
    // the pointer by hand: a midpoint below zero means the pointer is in its lower half.
    row("C").getBoundingClientRect = () =>
      ({ top: -20, height: 10, bottom: -10, left: 0, right: 0, width: 0, x: 0, y: -20, toJSON() {} }) as DOMRect;
    expect(fireEvent.dragOver(row("C"), { dataTransfer: transfer() })).toBe(false);
    expect(row("C").getAttribute("data-insert")).toBe("after");
    fireEvent.drop(row("C"), { dataTransfer: transfer() });
    expect(onReorder).toHaveBeenCalledWith(["todo/b.md", "todo/c.md", "todo/a.md"]);
  });

  it("drags a pin above another", () => {
    const { onReorder, row } = setupPins();
    fireEvent.dragStart(row("C"), { dataTransfer: transfer() });
    fireEvent.dragOver(row("A"), { dataTransfer: transfer(), clientY: 0 });
    expect(row("A").getAttribute("data-insert")).toBe("before");
    fireEvent.drop(row("A"), { dataTransfer: transfer(), clientY: 0 });
    expect(onReorder).toHaveBeenCalledWith(["todo/c.md", "todo/a.md", "todo/b.md"]);
  });

  it("a note from the tree dropped on a row lands at that row", () => {
    const { onReorder, row } = setupPins();
    fireEvent.dragStart(row("alpha"), { dataTransfer: transfer() });
    fireEvent.drop(row("B"), { dataTransfer: transfer(), clientY: 0 });
    expect(onReorder).toHaveBeenCalledWith(["todo/a.md", "notes/alpha.md", "todo/b.md", "todo/c.md"]);
  });

  it("dropping a pin where it already is changes nothing", () => {
    const { onReorder, row } = setupPins();
    fireEvent.dragStart(row("A"), { dataTransfer: transfer() });
    fireEvent.drop(row("B"), { dataTransfer: transfer(), clientY: 0 });
    expect(onReorder).not.toHaveBeenCalled();
  });
});
