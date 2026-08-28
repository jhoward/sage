import { useState } from "react";
import type { FileNode } from "../backend";

interface Props {
  nodes: FileNode[];
  selected: string | null;
  onOpen: (path: string) => void;
  /** Alt-click: open in the split pane instead. */
  onOpenAlt?: (path: string) => void;
}

export function FileTree({ nodes, selected, onOpen, onOpenAlt }: Props) {
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
}: {
  node: FileNode;
  depth: number;
  selected: string | null;
  onOpen: (path: string) => void;
  onOpenAlt?: (path: string) => void;
}) {
  // Top-level folders start open; deeper ones stay collapsed.
  const [open, setOpen] = useState(depth === 0);
  const isSelected = node.path === selected;
  const pad = { paddingLeft: `${depth * 12 + 12}px` };

  if (node.isDir) {
    return (
      <div>
        <button
          onClick={() => setOpen(!open)}
          className="flex w-full items-center gap-1 py-[3px] text-left hover:opacity-70"
          style={{ ...pad, color: "var(--sage-muted)" }}
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
      title={onOpenAlt ? "⌥-click to open in split pane" : undefined}
      className="block w-full truncate py-[3px] text-left"
      style={{
        ...pad,
        background: isSelected ? "color-mix(in srgb, var(--sage-accent) 14%, transparent)" : undefined,
        color: isSelected ? "var(--sage-accent)" : "var(--sage-fg)",
      }}
    >
      {node.name.replace(/\.md$/, "")}
    </button>
  );
}
