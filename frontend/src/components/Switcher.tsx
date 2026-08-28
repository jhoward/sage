import { useEffect, useMemo, useRef, useState } from "react";
import { filterCommands, groupCommands, type Command } from "../lib/commands";

/**
 * A generic pick-one-thing overlay.
 *
 * The command palette and the file switcher are the same widget with different lists —
 * which is the point of splitting them. A file is an *object* and a command is an
 * *action*; mixing them in one list is what makes a palette useless at 500 notes. Keeping
 * one component means the split costs nothing in code.
 */
export function Switcher({
  open,
  items,
  placeholder,
  footer,
  onClose,
  emptyLabel = "No matches",
}: {
  open: boolean;
  items: Command[];
  placeholder: string;
  footer?: string;
  onClose: () => void;
  emptyLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(
    () => filterCommands(query, items).slice(0, 40),
    [query, items],
  );

  // Headings only while browsing. Once someone types, ranking beats tidiness.
  const sections = useMemo(
    () => (query.trim() ? [{ group: null, items: matches }] : groupCommands(matches)),
    [query, matches],
  );
  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      input.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open) return null;

  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    void c.run();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      style={{ background: "rgba(0,0,0,0.35)" }}
      onMouseDown={onClose}
    >
      <div
        className="w-[min(620px,92vw)] overflow-hidden rounded-lg border shadow-2xl"
        style={{ background: "var(--sage-panel)", borderColor: "var(--sage-border)" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={input}
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") return onClose();
            if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, flat.length - 1));
            }
            if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            }
            if (e.key === "Enter") {
              e.preventDefault();
              run(flat[cursor]);
            }
          }}
          className="w-full border-b bg-transparent px-3.5 py-3 text-sm outline-none"
          style={{ color: "var(--sage-fg)", borderColor: "var(--sage-border)" }}
        />

        <div ref={listRef} className="max-h-[50vh] overflow-auto py-1">
          {flat.length === 0 && (
            <div className="px-3.5 py-3 text-sm" style={{ color: "var(--sage-muted)" }}>
              {emptyLabel}
            </div>
          )}
          {sections.map((section) => (
            <div key={section.group ?? "_"}>
              {section.group && (
                <div
                  className="px-3.5 pb-1 pt-2 text-[10px] font-semibold tracking-wider"
                  style={{ color: "var(--sage-muted)" }}
                >
                  {section.group.toUpperCase()}
                </div>
              )}
              {section.items.map((c) => {
                const i = flat.indexOf(c);
                return (
                  <button
                    key={c.id}
                    data-index={i}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => run(c)}
                    className="flex w-full items-center justify-between gap-4 px-3.5 py-2 text-left text-sm"
                    style={{
                      background:
                        i === cursor
                          ? "color-mix(in srgb, var(--sage-accent) 14%, transparent)"
                          : undefined,
                      color: i === cursor ? "var(--sage-accent)" : "var(--sage-fg)",
                    }}
                  >
                    <span className="truncate">{c.title}</span>
                    {c.hint && (
                      <span
                        className="shrink-0 text-[11px]"
                        style={{ color: "var(--sage-muted)" }}
                      >
                        {c.hint}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {footer && (
          <div
            className="border-t px-3.5 py-1.5 text-[11px]"
            style={{ borderColor: "var(--sage-border)", color: "var(--sage-muted)" }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
