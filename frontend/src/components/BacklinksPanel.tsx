import type { SearchHit } from "../backend";

/**
 * Notes linking to the one that is open.
 *
 * Built on search() rather than a backlink index — nothing to rebuild, nothing to go
 * stale, and the backend contract stays as small as it was.
 */
export function BacklinksPanel({
  hits,
  onOpen,
}: {
  hits: SearchHit[];
  onOpen: (path: string) => void;
}) {
  if (!hits.length) return null;

  return (
    <div
      className="max-h-48 shrink-0 overflow-auto border-t px-4 py-2"
      style={{ borderColor: "var(--sage-border)", background: "var(--sage-panel)" }}
    >
      <div
        className="mb-1 text-[11px] font-semibold tracking-wide"
        style={{ color: "var(--sage-muted)" }}
      >
        {hits.length} LINK{hits.length > 1 ? "S" : ""} HERE
      </div>
      {hits.map((h) => (
        <button
          key={`${h.path}:${h.line}`}
          onClick={() => onOpen(h.path)}
          className="block w-full truncate py-0.5 text-left text-xs"
          style={{ color: "var(--sage-fg)" }}
        >
          <span style={{ color: "var(--sage-accent)" }}>
            {h.path.replace(/\.md$/, "")}
          </span>
          <span style={{ color: "var(--sage-muted)" }}> · {h.text}</span>
        </button>
      ))}
    </div>
  );
}
