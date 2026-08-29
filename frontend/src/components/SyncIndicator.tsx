import type { SyncStatus } from "../backend";

/**
 * Always reads "local" in Phase 1. It exists now so that adding git sync later is a
 * backend change with no UI restructuring.
 */
export function SyncIndicator({ status }: { status: SyncStatus | null }) {
  if (!status) return null;

  const dot =
    status.state === "ok" ? "var(--ink-muted)"
    : status.state === "conflict" || status.state === "error" ? "#ef4444"
    : "#eab308";

  return (
    <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--ink-muted)" }}>
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: dot }} />
      {status.backend}
      {status.conflicts.length > 0 && (
        <span style={{ color: "#ef4444" }}>
          {status.conflicts.length} conflict{status.conflicts.length > 1 ? "s" : ""}
        </span>
      )}
    </div>
  );
}
