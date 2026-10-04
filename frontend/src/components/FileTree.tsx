import { useEffect, useRef, useState } from "react";
import type { FileNode, PinInfo } from "../backend";
import { canDrag, canPin, dropFolder, moveTarget } from "../lib/treeDrag";

/**
 * The note being dragged. Module-level because the browser hides a drag's data from
 * `dragover` — only `drop` may read it — and the highlight has to be decided on the way.
 */
let dragged: string | null = null;

/** Who wants to know when a drag starts and ends: the pinned area, which lives outside the tree. */
const dragging = new Set<(on: boolean) => void>();

/** How long a drag must rest on a closed folder before it opens. */
const SPRING_MS = 600;

/**
 * The pinned notes, above the tree.
 *
 * No hierarchy up here: a flat list of whatever you want within reach, in the order the
 * pins file has them. Any note can be dropped on it to pin it. This replaced two fixed
 * rows, "This week" and "Backlog", which were pins the app had chosen for you.
 */
export function PinnedList({
  pins,
  selected,
  onOpen,
  onOpenAlt,
  onContext,
  onPin,
}: {
  pins: PinInfo[];
  selected: string | null;
  onOpen: (path: string) => void;
  onOpenAlt?: (path: string) => void;
  onContext?: (target: { path: string; isDir: boolean }, at: { x: number; y: number }) => void;
  /** A note was dropped here. */
  onPin?: (path: string) => void;
}) {
  const [isDragging, setDragging] = useState(false);
  const [over, setOver] = useState(false);
  useEffect(() => {
    dragging.add(setDragging);
    return () => void dragging.delete(setDragging);
  }, []);

  // With nothing pinned the area is not there — until a drag begins, when it has to be,
  // or there would be no way to pin the first note by hand.
  if (!pins.length && !(isDragging && onPin)) return null;
  const paths = pins.map((p) => p.path);

  return (
    <div
      className="side-pins"
      data-drop={over || undefined}
      onDragOver={(e) => {
        if (!onPin || !dragged || !canPin(dragged, paths)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        const from = dragged;
        dragged = null;
        setOver(false);
        if (from && onPin && canPin(from, paths)) onPin(from);
      }}
    >
      {pins.map((pin) => (
        <button
          key={pin.path}
          onClick={(e) => (e.altKey && onOpenAlt ? onOpenAlt(pin.path) : onOpen(pin.path))}
          onContextMenu={(e) => {
            e.preventDefault();
            onContext?.({ path: pin.path, isDir: false }, { x: e.clientX, y: e.clientY });
          }}
          aria-current={pin.path === selected ? "true" : undefined}
          className="side-row"
          style={{ paddingLeft: 8 }}
          title={pin.path}
        >
          <span className="side-row-label">{pin.title}</span>
        </button>
      ))}
      {!pins.length && <div className="side-pins-empty">Drop to pin</div>}
    </div>
  );
}

interface Props {
  nodes: FileNode[];
  selected: string | null;
  onOpen: (path: string) => void;
  /** Alt-click: open in the split pane instead. */
  onOpenAlt?: (path: string) => void;
  /** Right-click on a note or a folder. */
  onContext?: (target: { path: string; isDir: boolean }, at: { x: number; y: number }) => void;
  /**
   * Double-click renames in place. Editing the name where you can see it means never
   * having to know there is a rename command — the gesture is the discovery.
   */
  onRename?: (target: { path: string; isDir: boolean }, name: string) => void;
  /**
   * A note was dropped somewhere it can go. The third way to reach "move", after the
   * palette and the right-click menu, and the one people try first.
   */
  onMove?: (from: string, to: string) => void;
}

export function FileTree({
  nodes,
  selected,
  onOpen,
  onOpenAlt,
  onContext,
  onRename,
  onMove,
}: Props) {
  // The folder a drop would land in right now, so its row can say so.
  const [dropInto, setDropInto] = useState<string | null>(null);
  const drag: DragProps = { dropInto, setDropInto, onMove };

  return (
    <div
      className="py-1.5"
      // Leaving the tree altogether, or letting go anywhere, ends the highlight.
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropInto(null);
      }}
      onDragEnd={() => {
        dragged = null;
        dragging.forEach((fn) => fn(false));
        setDropInto(null);
      }}
    >
      {nodes.map((n) => (
        <Node
          key={n.path}
          node={n}
          depth={0}
          selected={selected}
          onOpen={onOpen}
          onOpenAlt={onOpenAlt}
          onContext={onContext}
          onRename={onRename}
          drag={drag}
        />
      ))}
    </div>
  );
}

interface DragProps {
  dropInto: string | null;
  setDropInto: (folder: string | null) => void;
  onMove?: (from: string, to: string) => void;
}

/** dragover/drop for one row: accept the drag only where `moveTarget` says it can land. */
function dropHandlers(node: FileNode, drag: DragProps | undefined) {
  if (!drag?.onMove) return {};
  const target = { path: node.path, isDir: node.isDir };
  return {
    onDragOver: (e: React.DragEvent) => {
      if (!dragged || !moveTarget(dragged, target)) return;
      e.preventDefault(); // this is what tells the browser a drop is allowed here
      e.dataTransfer.dropEffect = "move";
      drag.setDropInto(dropFolder(target));
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const from = dragged;
      const to = from && moveTarget(from, target);
      dragged = null;
      drag.setDropInto(null);
      if (from && to) drag.onMove?.(from, to);
    },
  };
}

/**
 * The name shown for a node: a note's title when it has one, else its file name without
 * the extension. Pinned rows show titles, so the tree does too — one note, one name.
 */
function displayName(node: FileNode): string {
  if (node.isDir) return node.name;
  return node.title || node.name.replace(/\.md$/, "");
}

/**
 * Edit a name in place.
 *
 * Enter and blur both commit; Escape cancels. Committing on blur matches Finder — after
 * typing a new name, clicking away meaning "discard that" is the rarer intention.
 */
function NameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const commit = () => {
    if (done.current) return;
    done.current = true;
    const next = value.trim();
    if (next && next !== initial) onCommit(next);
    else onCancel();
  };

  return (
    <input
      ref={input}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") commit();
        if (e.key === "Escape") {
          done.current = true;
          onCancel();
        }
      }}
      className="w-full rounded bg-transparent px-1 text-sm outline-none"
      style={{
        color: "var(--ink-fg)",
        boxShadow: "inset 0 0 0 1px var(--ink-accent)",
      }}
    />
  );
}

function Node({
  node,
  depth,
  selected,
  onOpen,
  onOpenAlt,
  onContext,
  onRename,
  drag,
}: {
  node: FileNode;
  depth: number;
  selected: string | null;
  onOpen: (path: string) => void;
  onOpenAlt?: (path: string) => void;
  onContext?: (target: { path: string; isDir: boolean }, at: { x: number; y: number }) => void;
  onRename?: (target: { path: string; isDir: boolean }, name: string) => void;
  drag?: DragProps;
}) {
  // Top-level folders start open; deeper ones stay collapsed.
  const [open, setOpen] = useState(depth === 0);
  const spring = useRef<number | null>(null);
  const drops = dropHandlers(node, drag);
  const [editing, setEditing] = useState(false);
  const isSelected = node.path === selected;
  // A note sits under its folder's label, not under the chevron: the chevron's width
  // plus its gap is added so the two text columns line up.
  const pad = { paddingLeft: `${depth * 14 + (node.isDir ? 6 : 22)}px` };

  if (node.isDir) {
    return (
      <div>
        <button
          onContextMenu={(e) => {
            e.preventDefault();
            onContext?.({ path: node.path, isDir: true }, { x: e.clientX, y: e.clientY });
          }}
          onClick={() => setOpen(!open)}
          onDoubleClick={() => setEditing(true)}
          aria-expanded={open}
          className="side-row side-row-folder"
          data-drop={drag?.dropInto === node.path || undefined}
          style={pad}
          {...drops}
          // A closed folder opens under a drag that rests on it, or there would be no
          // way to reach a subfolder without opening it first.
          onDragEnter={() => {
            if (open || !dragged || spring.current !== null) return;
            spring.current = window.setTimeout(() => {
              spring.current = null;
              setOpen(true);
            }, SPRING_MS);
          }}
          onDragLeave={() => {
            if (spring.current !== null) window.clearTimeout(spring.current);
            spring.current = null;
          }}
        >
          <Chevron open={open} />
          {editing ? (
            <NameInput
              initial={node.name}
              onCommit={(name) => {
                setEditing(false);
                onRename?.({ path: node.path, isDir: true }, name);
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <span className="side-row-label">{node.name}</span>
          )}
        </button>
        {open &&
          node.children?.map((c) => (
            <Node
              key={c.path}
              node={c}
              depth={depth + 1}
              selected={selected}
              onOpen={onOpen}
              onOpenAlt={onOpenAlt}
              onContext={onContext}
              onRename={onRename}
              drag={drag}
            />
          ))}
      </div>
    );
  }

  return (
    <button
      onClick={(e) =>
        e.altKey && onOpenAlt ? onOpenAlt(node.path) : onOpen(node.path)
      }
      onContextMenu={(e) => {
        e.preventDefault();
        onContext?.({ path: node.path, isDir: false }, { x: e.clientX, y: e.clientY });
      }}
      onDoubleClick={() => setEditing(true)}
      title={onOpenAlt ? "⌥-click for split · double-click to rename" : undefined}
      aria-current={isSelected ? "true" : undefined}
      className="side-row"
      style={pad}
      draggable={!editing && !!drag?.onMove && canDrag(node)}
      onDragStart={(e) => {
        dragged = node.path;
        dragging.forEach((fn) => fn(true));
        e.dataTransfer.effectAllowed = "move";
        // Firefox will not start a drag that carries no data.
        e.dataTransfer.setData("text/plain", displayName(node));
      }}
      {...drops}
    >
      {editing ? (
        <NameInput
          initial={displayName(node)}
          onCommit={(name) => {
            setEditing(false);
            onRename?.({ path: node.path, isDir: false }, name);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <span className="side-row-label">{displayName(node)}</span>
      )}
    </button>
  );
}

/**
 * One chevron that rotates, rather than the ▸ and ▾ glyphs: those come from whatever font
 * has them, at different sizes and baselines, so the row twitched when a folder opened.
 */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg className="side-chevron" data-open={open} viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M4.5 2.5 8 6l-3.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
