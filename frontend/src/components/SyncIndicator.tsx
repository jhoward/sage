import type { SyncStatus } from "../backend";

type Tone = "off" | "good" | "waiting" | "bad";

/**
 * What the dot says. Four colours, and the line between yellow and red is "will this
 * resolve without you": edits waiting for a pause, a push in progress and a missing
 * network all pass on their own, so they are yellow. Red is kept for what will still be
 * wrong tomorrow — a laptop is offline a lot, and a red that fires on every train ride
 * is a red nobody reads.
 *
 * Grey means off. It used to mean "fine", which made a healthy backup look disabled.
 */
export function describeSync(status: SyncStatus): { tone: Tone; word: string; title: string } {
  if (status.backend === "local") {
    return {
      tone: "off",
      word: "backup off",
      title: "Backup is off: files only, no history. Turn it on in Settings.",
    };
  }

  const localOnly = status.detail === "local history only";
  const table: Record<SyncStatus["state"], { tone: Tone; word: string; title: string }> = {
    ok: {
      tone: "good",
      word: localOnly ? "saved" : "synced",
      title: localOnly
        ? "Everything is committed — on this Mac only. Add a remote in Settings for an offsite copy."
        : "Everything is committed and pushed.",
    },
    pending: { tone: "waiting", word: "pending", title: "Edits are waiting to be committed; it happens when you pause." },
    syncing: { tone: "waiting", word: "syncing", title: "Talking to the remote…" },
    offline: { tone: "waiting", word: "offline", title: "No network. Your commits are safe here and will be pushed later." },
    conflict: { tone: "bad", word: "conflict", title: "Edited here and elsewhere. Resolve with git in the vault folder." },
    error: { tone: "bad", word: "sync failed", title: "Backup needs attention." },
  };

  const entry = table[status.state];
  // The backend's own words go under ours, except where ours already said it.
  const extra = [localOnly || status.state === "offline" ? "" : status.detail, ...status.conflicts];
  return { ...entry, title: [entry.title, ...extra].filter(Boolean).join("\n") };
}

export function SyncIndicator({ status }: { status: SyncStatus | null }) {
  if (!status) return null;
  const { tone, word, title } = describeSync(status);

  return (
    <div className="sync-indicator" data-tone={tone} title={title}>
      <span className="sync-dot" />
      {word}
    </div>
  );
}
