import { useEffect, useRef, useState } from "react";
import type { FileNode } from "../backend";

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
}

export function FileTree({ nodes, selected, onOpen, onOpenAlt, onContext, onRename }: Props) {
  return (
    <div className="py-2 text-sm">
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
        />
      ))}
    </div>
  );
}

/** The name shown for a node, without its extension. */
function displayName(node: FileNode): string {
  return node.isDir ? node.name : node.name.replace(/\.md$/, "");
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
}: {
  node: FileNode;
  depth: number;
  selected: string | null;
  onOpen: (path: string) => void;
  onOpenAlt?: (path: string) => void;
  onContext?: (target: { path: string; isDir: boolean }, at: { x: number; y: number }) => void;
  onRename?: (target: { path: string; isDir: boolean }, name: string) => void;
}) {
  // Top-level folders start open; deeper ones stay collapsed.
  const [open, setOpen] = useState(depth === 0);
  const [editing, setEditing] = useState(false);
  const isSelected = node.path === selected;
  const pad = { paddingLeft: `${depth * 12 + 12}px` };

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
          className="flex w-full items-center gap-1 py-[3px] text-left hover:opacity-70"
          style={{ ...pad, color: "var(--ink-muted)" }}
        >
          <span className="inline-block w-3 text-[10px]">{open ? "▾" : "▸"}</span>
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
            node.name
          )}
        </button>
        {open &&
          node.children?.map((c) => (
            <Node key={c.path} node={c} depth={depth + 1} selected={selected} onOpen={onOpen} />
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
      className="block w-full truncate py-[3px] text-left"
      style={{
        ...pad,
        background: isSelected ? "color-mix(in srgb, var(--ink-accent) 14%, transparent)" : undefined,
        color: isSelected ? "var(--ink-accent)" : "var(--ink-fg)",
      }}
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
        displayName(node)
      )}
    </button>
  );
}
