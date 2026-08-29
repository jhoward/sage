import { useEffect, useMemo, useRef, useState } from "react";

export interface PickItem {
  id: string;
  label: string;
  hint?: string;
}

/**
 * Pick several things at once.
 *
 * Pulling a week's worth of work out of the backlog through a one-at-a-time palette is
 * miserable — ⌘K, search, enter, repeat. Space toggles, Enter takes everything selected.
 */
export function MultiPicker({
  open,
  title,
  items,
  emptyLabel,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  items: PickItem[];
  emptyLabel: string;
  confirmLabel: (n: number) => string;
  onClose: () => void;
  onConfirm: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? items.filter((i) => `${i.label} ${i.hint ?? ""}`.toLowerCase().includes(q))
      : items;
  }, [query, items]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      setPicked(new Set());
      input.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open) return null;

  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const confirm = () => {
    // Enter with nothing ticked takes the row under the cursor, so the single-item case
    // stays one keystroke rather than two.
    const ids = picked.size ? [...picked] : visible[cursor] ? [visible[cursor].id] : [];
    if (!ids.length) return;
    onConfirm(ids);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      style={{ background: "rgba(0,0,0,0.35)" }}
      onMouseDown={onClose}
    >
      <div
        className="w-[min(620px,92vw)] overflow-hidden rounded-lg border shadow-2xl"
        style={{ background: "var(--ink-panel)", borderColor: "var(--ink-border)" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="border-b px-3.5 py-1.5 text-[11px]"
          style={{ borderColor: "var(--ink-border)", color: "var(--ink-muted)" }}
        >
          {title}
        </div>
        <input
          ref={input}
          value={query}
          placeholder="Filter…"
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") return onClose();
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, visible.length - 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            }
            if (e.key === " " && visible[cursor]) {
              e.preventDefault();
              toggle(visible[cursor].id);
            }
            if (e.key === "Enter") {
              e.preventDefault();
              confirm();
            }
          }}
          className="w-full border-b bg-transparent px-3.5 py-2.5 text-sm outline-none"
          style={{ color: "var(--ink-fg)", borderColor: "var(--ink-border)" }}
        />

        <div ref={listRef} className="max-h-[45vh] overflow-auto py-1">
          {visible.length === 0 && (
            <div className="px-3.5 py-3 text-sm" style={{ color: "var(--ink-muted)" }}>
              {emptyLabel}
            </div>
          )}
          {visible.map((item, i) => (
            <button
              key={item.id}
              data-index={i}
              onMouseEnter={() => setCursor(i)}
              onClick={() => toggle(item.id)}
              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm"
              style={{
                background:
                  i === cursor
                    ? "color-mix(in srgb, var(--ink-accent) 14%, transparent)"
                    : undefined,
              }}
            >
              <span
                className="shrink-0 font-mono text-xs"
                style={{ color: picked.has(item.id) ? "var(--ink-accent)" : "var(--ink-muted)" }}
              >
                {picked.has(item.id) ? "[x]" : "[ ]"}
              </span>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.hint && (
                <span className="shrink-0 text-[11px]" style={{ color: "var(--ink-muted)" }}>
                  {item.hint}
                </span>
              )}
            </button>
          ))}
        </div>

        <div
          className="flex items-center justify-between border-t px-3.5 py-2 text-[11px]"
          style={{ borderColor: "var(--ink-border)", color: "var(--ink-muted)" }}
        >
          <span>space toggles · ↵ confirms · esc cancels</span>
          <button
            onClick={confirm}
            className="rounded px-2.5 py-1 text-xs"
            style={{ background: "var(--ink-accent)", color: "white" }}
          >
            {confirmLabel(picked.size)}
          </button>
        </div>
      </div>
    </div>
  );
}
