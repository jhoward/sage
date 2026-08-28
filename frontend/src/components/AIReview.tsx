import { useEffect, useRef } from "react";
import type { SkillInfo } from "../backend";

/**
 * Generated text lands here first, never straight into the document.
 *
 * "Every AI mutation is reviewable and revertible" is a design principle, not a nicety —
 * an app where a model can silently rewrite your thinking is one you cannot trust with
 * your thinking. Accepting is the only thing that touches the file.
 */
export function AIReview({
  skill,
  text,
  streaming,
  error,
  onAccept,
  onAcceptPlain,
  onReject,
}: {
  skill: SkillInfo | null;
  text: string;
  streaming: boolean;
  error: string | null;
  onAccept: () => void;
  onAcceptPlain: () => void;
  onReject: () => void;
}) {
  const body = useRef<HTMLDivElement>(null);

  // Follow the output as it streams.
  useEffect(() => {
    if (streaming && body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [text, streaming]);

  // Escape rejects; Cmd-Enter accepts. Both only once the stream has finished.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onReject();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !streaming && !error) {
        e.preventDefault();
        onAccept();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [streaming, error, onAccept, onReject]);

  if (!skill) return null;

  return (
    <div
      className="flex max-h-[45vh] shrink-0 flex-col border-t"
      style={{ borderColor: "var(--sage-border)", background: "var(--sage-panel)" }}
    >
      <div
        className="flex shrink-0 items-center justify-between border-b px-4 py-1.5 text-[11px]"
        style={{ borderColor: "var(--sage-border)", color: "var(--sage-muted)" }}
      >
        <span>
          <span style={{ color: "var(--sage-accent)" }}>{skill.title}</span>
          {streaming && " · generating…"}
          {!streaming && !error && ` · will ${skill.mode}`}
        </span>
        <span>{streaming ? "esc to stop" : "⌘↵ accept · esc discard"}</span>
      </div>

      <div
        ref={body}
        className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap px-4 py-3 text-sm"
        style={{
          fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
          color: error ? "#ef4444" : "var(--sage-fg)",
        }}
      >
        {error ?? text}
        {streaming && <span style={{ color: "var(--sage-muted)" }}>▍</span>}
      </div>

      {!streaming && !error && text.trim() && (
        <div
          className="flex shrink-0 gap-2 border-t px-4 py-2"
          style={{ borderColor: "var(--sage-border)" }}
        >
          <button
            onClick={onAccept}
            className="rounded px-2.5 py-1 text-xs"
            style={{ background: "var(--sage-accent)", color: "white" }}
          >
            Accept
          </button>
          <button
            onClick={onAcceptPlain}
            className="rounded border px-2.5 py-1 text-xs"
            style={{ borderColor: "var(--sage-border)", color: "var(--sage-fg)" }}
            title="Insert without the sage:ai provenance markers"
          >
            Accept as mine
          </button>
          <button
            onClick={onReject}
            className="rounded px-2.5 py-1 text-xs"
            style={{ color: "var(--sage-muted)" }}
          >
            Discard
          </button>
        </div>
      )}

      {error && (
        <div
          className="shrink-0 border-t px-4 py-2"
          style={{ borderColor: "var(--sage-border)" }}
        >
          <button
            onClick={onReject}
            className="rounded px-2.5 py-1 text-xs"
            style={{ color: "var(--sage-muted)" }}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
