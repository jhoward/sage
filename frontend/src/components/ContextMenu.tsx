import { useEffect, useRef } from "react";

export interface MenuItem {
  label: string;
  danger?: boolean;
  run: () => void;
}

/**
 * Right-click menu for the file tree.
 *
 * The keyboard palette is the primary surface, but nothing about that argues against the
 * gesture everyone already knows. This is additive: every item here is also a command, so
 * there is one behaviour reachable two ways rather than two behaviours.
 */
export function ContextMenu({
  at,
  items,
  onClose,
}: {
  at: { x: number; y: number } | null;
  items: MenuItem[];
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!at) return;
    const dismiss = () => onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();

    // Any click, scroll or Escape closes it — a menu that outlives its context is worse
    // than no menu.
    window.addEventListener("mousedown", dismiss);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [at, onClose]);

  if (!at) return null;

  // Keep it on screen when opened near an edge.
  const width = 190;
  const height = items.length * 30 + 8;
  const x = Math.min(at.x, window.innerWidth - width - 8);
  const y = Math.min(at.y, window.innerHeight - height - 8);

  return (
    <div
      ref={menu}
      className="fixed z-50 overflow-hidden rounded-md border py-1 shadow-xl"
      style={{
        left: x,
        top: y,
        width,
        background: "var(--ink-panel)",
        borderColor: "var(--ink-border)",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          onClick={() => {
            onClose();
            item.run();
          }}
          className="block w-full px-3 py-1 text-left text-xs hover:opacity-70"
          style={{ color: item.danger ? "#dc2626" : "var(--ink-fg)" }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
