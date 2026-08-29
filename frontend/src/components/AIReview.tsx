import { useEffect, useRef, useState } from "react";
import type { SkillInfo } from "../backend";

/**
 * Errors are the text people most need to get out of the app and into a search box or a
 * message. Selection alone is fiddly in a webview panel, so there is a button.
 */
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          // Clipboard API can be unavailable; fall back to a selection the user can ⌘C.
          const el = document.createElement("textarea");
          el.value = text;
          document.body.appendChild(el);
          el.select();
          document.execCommand("copy");
          el.remove();
        }
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}
      className="rounded border px-2.5 py-1 text-xs"
      style={{ borderColor: "var(--ink-border)", color: "var(--ink-fg)" }}
    >
      {copied ? "Copied" : "Copy error"}
    </button>
  );
}

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
  onReject,
}: {
  skill: SkillInfo | null;
  text: string;
  streaming: boolean;
  error: string | null;
  onAccept: () => void;
  onReject: () => void;
}) {
  const body = useRef<HTMLDivElement>(null);
  const acceptBtn = useRef<HTMLButtonElement>(null);

  // Follow the output as it streams.
  useEffect(() => {
    if (streaming && body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [text, streaming]);

  // Take focus once there is something to decide on. Until this, the panel was never
  // focused, so a plain Enter went to the editor and inserted a newline — only ⌘↵ worked,
  // through a window-level listener. Focusing the button makes Enter mean what it looks
  // like it means.
  useEffect(() => {
    if (!streaming && !error && text.trim()) acceptBtn.current?.focus();
  }, [streaming, error, text]);

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
      style={{ borderColor: "var(--ink-border)", background: "var(--ink-panel)" }}
    >
      <div
        className="flex shrink-0 items-center justify-between border-b px-4 py-1.5 text-[11px]"
        style={{ borderColor: "var(--ink-border)", color: "var(--ink-muted)" }}
      >
        <span>
          <span style={{ color: "var(--ink-accent)" }}>{skill.title}</span>
          {streaming && " · generating…"}
          {!streaming && !error && ` · will ${skill.mode}`}
        </span>
        <span>{streaming ? "esc to stop" : "↵ accept · esc discard"}</span>
      </div>

      <div
        ref={body}
        className="cm-selectable min-h-0 flex-1 overflow-auto whitespace-pre-wrap px-4 py-3 text-sm"
        style={{
          fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
          color: error ? "#ef4444" : "var(--ink-fg)",
        }}
      >
        {error ?? text}
        {streaming && <span style={{ color: "var(--ink-muted)" }}>▍</span>}
      </div>

      {!streaming && !error && text.trim() && (
        <div
          className="flex shrink-0 gap-2 border-t px-4 py-2"
          style={{ borderColor: "var(--ink-border)" }}
        >
          <button
            ref={acceptBtn}
            onClick={onAccept}
            className="rounded px-2.5 py-1 text-xs"
            style={{ background: "var(--ink-accent)", color: "white" }}
          >
            Accept
          </button>
          <button
            onClick={onReject}
            className="rounded px-2.5 py-1 text-xs"
            style={{ color: "var(--ink-muted)" }}
          >
            Discard
          </button>
        </div>
      )}

      {error && (
        <div
          className="flex shrink-0 gap-2 border-t px-4 py-2"
          style={{ borderColor: "var(--ink-border)" }}
        >
          <CopyButton text={error} />
          <button
            onClick={onReject}
            className="rounded px-2.5 py-1 text-xs"
            style={{ color: "var(--ink-muted)" }}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
