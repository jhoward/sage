import { useEffect, useRef, useState } from "react";

/**
 * A one-line text prompt. New note, rename, vault search all ask for exactly one string,
 * so they share one component rather than each growing a dialog.
 */
export function Prompt({
  open,
  label,
  placeholder,
  initial = "",
  onClose,
  onSubmit,
}: {
  open: boolean;
  label: string;
  placeholder?: string;
  initial?: string;
  onClose: () => void;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(initial);
      // Defer so the value is committed before selecting it.
      requestAnimationFrame(() => {
        input.current?.focus();
        input.current?.select();
      });
    }
  }, [open, initial]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      style={{ background: "rgba(0,0,0,0.35)" }}
      onMouseDown={onClose}
    >
      <div
        className="w-[min(560px,90vw)] overflow-hidden rounded-lg border shadow-2xl"
        style={{ background: "var(--sage-panel)", borderColor: "var(--sage-border)" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="border-b px-3.5 py-1.5 text-[11px]"
          style={{ borderColor: "var(--sage-border)", color: "var(--sage-muted)" }}
        >
          {label}
        </div>
        <input
          ref={input}
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter" && value.trim()) onSubmit(value.trim());
          }}
          className="w-full bg-transparent px-3.5 py-2.5 text-sm outline-none"
          style={{ color: "var(--sage-fg)" }}
        />
      </div>
    </div>
  );
}
