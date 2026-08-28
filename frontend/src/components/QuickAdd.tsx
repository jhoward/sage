import { useEffect, useRef, useState } from "react";

/**
 * ⌘⇧T from anywhere. Everything lands in `## Inbox` with no decisions at capture time;
 * triage happens later, when you are in that mode.
 */
export function QuickAdd({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (text: string) => void;
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
        className="w-[min(560px,90vw)] rounded-lg border p-1 shadow-2xl"
        style={{ background: "var(--sage-panel)", borderColor: "var(--sage-border)" }}
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
              onSubmit(text.trim());
              onClose();
            }
          }}
          className="w-full bg-transparent px-3 py-2.5 text-sm outline-none"
          style={{ color: "var(--sage-fg)" }}
        />
      </div>
    </div>
  );
}
