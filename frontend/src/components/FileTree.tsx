import { useState } from "react";
import type { FileNode } from "../backend";

interface Props {
  nodes: FileNode[];
  selected: string | null;
  onOpen: (path: string) => void;
  /** Alt-click: open in the split pane instead. */
  onOpenAlt?: (path: string) => void;
  /** Right-click on a note or a folder. */
  onContext?: (target: { path: string; isDir: boolean }, at: { x: number; y: number }) => void;
}

export function FileTree({ nodes, selected, onOpen, onOpenAlt, onContext }: Props) {
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
        />
      ))}
    </div>
  );
}

function Node({
  node,
  depth,
  selected,
  onOpen,
  onOpenAlt,
  onContext,
}: {
  node: FileNode;
  depth: number;
  selected: string | null;
  onOpen: (path: string) => void;
  onOpenAlt?: (path: string) => void;
  onContext?: (target: { path: string; isDir: boolean }, at: { x: number; y: number }) => void;
}) {
  // Top-level folders start open; deeper ones stay collapsed.
  const [open, setOpen] = useState(depth === 0);
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
          className="flex w-full items-center gap-1 py-[3px] text-left hover:opacity-70"
          style={{ ...pad, color: "var(--ink-muted)" }}
        >
          <span className="inline-block w-3 text-[10px]">{open ? "▾" : "▸"}</span>
          {node.name}
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
      title={onOpenAlt ? "⌥-click to open in split pane" : undefined}
      className="block w-full truncate py-[3px] text-left"
      style={{
        ...pad,
        background: isSelected ? "color-mix(in srgb, var(--ink-accent) 14%, transparent)" : undefined,
        color: isSelected ? "var(--ink-accent)" : "var(--ink-fg)",
      }}
    >
      {node.name.replace(/\.md$/, "")}
    </button>
  );
}
