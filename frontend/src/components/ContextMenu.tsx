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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      // Arrows walk the items, as they do in every native menu; Enter is then the
      // focused button's own behaviour and needs no code.
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const buttons = [...(menu.current?.querySelectorAll("button") ?? [])];
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const step = e.key === "ArrowDown" ? 1 : -1;
      buttons[(at + step + buttons.length) % buttons.length]?.focus();
    };

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

  // Destructive items are set apart by a rule, so "Delete" is never one slip of the
  // pointer below "Archive" with nothing in between.
  const firstDanger = items.findIndex((i) => i.danger);
  const ruled = firstDanger > 0;

  // Keep it on screen when opened near an edge.
  const width = 200;
  const height = items.length * 28 + 10 + (ruled ? 9 : 0);
  const x = Math.min(at.x, window.innerWidth - width - 8);
  const y = Math.min(at.y, window.innerHeight - height - 8);

  return (
    <div
      ref={menu}
      role="menu"
      className="ctx-menu"
      style={{ left: x, top: y, width }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((item, i) => (
        <div key={item.label} role="none">
          {ruled && i === firstDanger && <div className="ctx-rule" role="separator" />}
          <button
            role="menuitem"
            onClick={() => {
              onClose();
              item.run();
            }}
            // Hovering moves focus, so the pointer and the arrow keys share one
            // highlight instead of showing two.
            onMouseEnter={(e) => e.currentTarget.focus()}
            className="ctx-item"
            data-danger={item.danger || undefined}
          >
            {item.label}
          </button>
        </div>
      ))}
    </div>
  );
}
