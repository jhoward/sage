import type { SyncStatus } from "../backend";

/** What each state means, in words — the dot alone says too little to act on. */
const LABELS: Record<SyncStatus["state"], string> = {
  ok: "Up to date",
  syncing: "Syncing…",
  offline: "Offline — changes are saved and committed here, and will be pushed later",
  conflict: "Edited here and elsewhere",
  error: "Sync problem",
};

/**
 * One dot and the backend's name. Quiet when all is well, because that is nearly always;
 * the detail is in the tooltip for the rare time it is needed.
 */
export function SyncIndicator({ status }: { status: SyncStatus | null }) {
  if (!status) return null;

  const dot =
    status.state === "ok" ? "var(--ink-muted)"
    : status.state === "conflict" || status.state === "error" ? "var(--ink-danger)"
    : "#eab308";

  const title = [LABELS[status.state], status.detail, ...status.conflicts]
    .filter(Boolean)
    .join("\n");

  return (
    <div
      className="flex shrink-0 items-center gap-1.5 text-xs"
      style={{ color: "var(--ink-muted)" }}
      title={title}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: dot }} />
      {status.backend}
      {status.conflicts.length > 0 && (
        <span style={{ color: "var(--ink-danger)" }}>
          {status.conflicts.length} conflict{status.conflicts.length > 1 ? "s" : ""}
        </span>
      )}
    </div>
  );
}
