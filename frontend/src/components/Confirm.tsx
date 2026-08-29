import { useEffect, useRef } from "react";

/**
 * A yes/no confirmation.
 *
 * Delete used to ask you to type the note's name. That is friction which punishes the
 * careful and does nothing for the unlucky — the answer to an irreversible action is to
 * make it reversible, not to make it tedious. Deletes now snapshot into the undo slot, so
 * this only has to catch a misfire.
 */
export function Confirm({
  open,
  title,
  detail,
  confirmLabel = "Delete",
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  detail?: string;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) requestAnimationFrame(() => button.current?.focus());
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[22vh]"
      style={{ background: "rgba(0,0,0,0.35)" }}
      onMouseDown={onClose}
    >
      <div
        className="w-[min(460px,90vw)] overflow-hidden rounded-lg border shadow-2xl"
        style={{ background: "var(--ink-panel)", borderColor: "var(--ink-border)" }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        <div className="px-4 py-3">
          <p className="text-sm">{title}</p>
          {detail && (
            <p className="mt-1 text-xs" style={{ color: "var(--ink-muted)" }}>
              {detail}
            </p>
          )}
        </div>
        <div
          className="flex items-center justify-end gap-2 border-t px-4 py-2"
          style={{ borderColor: "var(--ink-border)" }}
        >
          <button
            onClick={onClose}
            className="rounded px-2.5 py-1 text-xs"
            style={{ color: "var(--ink-muted)" }}
          >
            Cancel
          </button>
          <button
            ref={button}
            onClick={onConfirm}
            className="rounded px-2.5 py-1 text-xs"
            style={{ background: "#dc2626", color: "white" }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
