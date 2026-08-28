import { useEffect, useMemo, useRef, useState } from "react";
import { filterCommands, type Command } from "../lib/commands";

const MAX_VISIBLE = 12;

export function CommandPalette({
  open,
  commands,
  onClose,
}: {
  open: boolean;
  commands: Command[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(
    () => filterCommands(query, commands).slice(0, MAX_VISIBLE),
    [query, commands],
  );

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      input.current?.focus();
    }
  }, [open]);

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    listRef.current?.children[cursor]?.scrollIntoView({ block: "nearest" });
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
          placeholder="Type a command…"
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") return onClose();
            if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, matches.length - 1));
            }
            if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            }
            if (e.key === "Enter") {
              e.preventDefault();
              run(matches[cursor]);
            }
          }}
          className="w-full border-b bg-transparent px-3.5 py-3 text-sm outline-none"
          style={{ color: "var(--sage-fg)", borderColor: "var(--sage-border)" }}
        />

        <div ref={listRef} className="max-h-[50vh] overflow-auto py-1">
          {matches.length === 0 && (
            <div className="px-3.5 py-3 text-sm" style={{ color: "var(--sage-muted)" }}>
              No matching command
            </div>
          )}
          {matches.map((c, i) => (
            <button
              key={c.id}
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
                  className="shrink-0 text-[11px] tabular-nums"
                  style={{ color: "var(--sage-muted)" }}
                >
                  {c.hint}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
