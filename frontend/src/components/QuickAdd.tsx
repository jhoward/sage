import { useEffect, useRef, useState } from "react";
import type { TaskSection } from "../backend";

/**
 * ⌘T from anywhere, regardless of which file is open.
 *
 * Enter captures to Now, ⇧Enter to the Backlog, of the list you have open — or the first
 * list when you are in a note. Capture stays decision-free: one place, named in the
 * footer so there is no guessing where it went.
 */
export function QuickAdd({
  open,
  list,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** The list the task will land in, for the footer. */
  list: string;
  onClose: () => void;
  onSubmit: (text: string, section: TaskSection) => void;
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
              onSubmit(text.trim(), e.shiftKey ? "backlog" : "now");
              onClose();
            }
          }}
          className="w-full bg-transparent px-3 py-2.5 text-sm outline-none"
          style={{ color: "var(--ink-fg)" }}
        />
        <div
          className="flex justify-between border-t px-3 py-1.5 text-[11px]"
          style={{ borderColor: "var(--ink-border)", color: "var(--ink-muted)" }}
        >
          <span>↵ now · ⇧↵ backlog</span>
          <span className="truncate">{list}</span>
        </div>
      </div>
    </div>
  );
}
