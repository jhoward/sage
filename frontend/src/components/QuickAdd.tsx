import { useEffect, useRef, useState } from "react";
import type { TaskTarget } from "../backend";

/**
 * ⌘⇧T from anywhere, regardless of which file is open.
 *
 * Enter captures to the bottom of this week, ⇧Enter to the backlog. Capture stays
 * decision-free — always the same place — and the place means "I'll get to it". Promote
 * with ⌘⇧↑ if it turns out to matter today.
 */
export function QuickAdd({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (text: string, target: TaskTarget) => void;
}) {
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setText("");
      input.current?.focus();
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      style={{ background: "rgba(0,0,0,0.35)" }}
      onMouseDown={onClose}
    >
      <div
        className="w-[min(560px,90vw)] overflow-hidden rounded-lg border shadow-2xl"
        style={{ background: "var(--ink-panel)", borderColor: "var(--ink-border)" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={input}
          value={text}
          placeholder="Add a task…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter" && text.trim()) {
              onSubmit(text.trim(), e.shiftKey ? "backlog" : "week");
              onClose();
            }
          }}
          className="w-full bg-transparent px-3 py-2.5 text-sm outline-none"
          style={{ color: "var(--ink-fg)" }}
        />
        <div
          className="border-t px-3 py-1.5 text-[11px]"
          style={{ borderColor: "var(--ink-border)", color: "var(--ink-muted)" }}
        >
          ↵ this week · ⇧↵ backlog
        </div>
      </div>
    </div>
  );
}
