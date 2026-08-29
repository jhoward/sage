import { useEffect, useRef, useState } from "react";
import { backend, type Proposal } from "../backend";

interface Turn {
  role: "user" | "assistant";
  text: string;
  read?: string[];
  proposals?: Proposal[];
  applied?: string[];
}

/**
 * Ask the vault.
 *
 * A side panel rather than a one-shot command, because the useful questions are
 * vault-wide and usually have follow-ups. Answers cite the notes they used, which is what
 * makes the thing checkable rather than an oracle.
 *
 * Proposed changes are reviewed as a *batch*, not one at a time: a set of note edits is
 * usually one thought spread across files, and approving the first without seeing the
 * fourth is how you end up with two that contradict each other.
 */
export function AskPanel({
  open,
  onClose,
  onOpenNote,
  onApplied,
  pending: pendingQuestion,
  onPendingConsumed,
}: {
  open: boolean;
  onClose: () => void;
  onOpenNote: (path: string) => void;
  onApplied: () => void;
  /** A question handed in from elsewhere — the meeting flow uses this. */
  pending?: string | null;
  onPendingConsumed?: () => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const input = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  // A question handed in from outside runs immediately: the meeting flow should go from
  // paste to proposed tasks without the user retyping what they already asked for.
  useEffect(() => {
    if (!pendingQuestion || busy) return;
    onPendingConsumed?.();
    void send(pendingQuestion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingQuestion]);

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [turns, busy]);

  const latest = turns.at(-1);
  const pending = latest?.proposals?.length && !latest.applied ? latest.proposals : null;

  // Destructive proposals start unticked and expanded: replacing text loses the original,
  // so it should be a deliberate choice rather than something you approve by momentum.
  useEffect(() => {
    if (!pending) return;
    setPicked(new Set(pending.map((p, i) => (p.destructive ? -1 : i)).filter((i) => i >= 0)));
    setExpanded(
      new Set(
        pending
          .map((p, i) => (p.destructive || p.tool === "create_note" ? i : -1))
          .filter((i) => i >= 0),
      ),
    );
  }, [pending]);

  if (!open) return null;

  const send = async (override?: string) => {
    const q = (override ?? question).trim();
    if (!q || busy) return;

    const history = turns.map((t) => ({ role: t.role, content: t.text }));
    setTurns((t) => [...t, { role: "user", text: q }]);
    setQuestion("");
    setBusy(true);
    setError(null);

    try {
      const answer = await backend.ask([...history, { role: "user", content: q }]);
      setTurns((t) => [
        ...t,
        {
          role: "assistant",
          text: answer.text,
          read: answer.read,
          proposals: answer.proposals,
        },
      ]);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Ask for the answer to be captured, rather than deciding where it goes here.
   *
   * An earlier version wrote `notes/2026-08-28-note.md` titled "Saved answer", which is
   * unfindable and says nothing. The model already knows the vault, so it is better placed
   * to name the note — or to decide the content belongs in an existing one. This goes back
   * through the normal proposal review, so the decision is still yours.
   */
  const capture = async () => {
    const ask =
      "Capture that. Add it to an existing note if it belongs in one, or create a new " +
      "note if it is its own topic — name it for what it says, not for today's date.";

    const history = turns.map((t) => ({ role: t.role, content: t.text }));
    setTurns((t) => [...t, { role: "user", text: "Capture that." }]);
    setBusy(true);
    setError(null);

    try {
      const answer = await backend.ask([...history, { role: "user", content: ask }]);
      setTurns((t) => [
        ...t,
        {
          role: "assistant",
          text: answer.text,
          read: answer.read,
          proposals: answer.proposals,
        },
      ]);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!pending) return;
    const chosen = pending.filter((_, i) => picked.has(i));
    if (!chosen.length) return;

    try {
      const { changed } = await backend.applyProposals(chosen);
      setTurns((t) =>
        t.map((turn, i) => (i === t.length - 1 ? { ...turn, applied: changed } : turn)),
      );
      onApplied();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <aside
      className="flex w-[380px] shrink-0 flex-col border-l"
      style={{ borderColor: "var(--ink-border)", background: "var(--ink-panel)" }}
    >
      <div
        className="flex h-9 shrink-0 items-center justify-between border-b px-4 text-xs"
        style={{ borderColor: "var(--ink-border)", color: "var(--ink-muted)" }}
      >
        <span>Ask the vault</span>
        <div className="flex items-center gap-3">
          {turns.length > 0 && (
            <button onClick={() => setTurns([])} title="Clear conversation">
              clear
            </button>
          )}
          <button onClick={onClose} title="Close">
            ✕
          </button>
        </div>
      </div>

      <div ref={scroller} className="cm-selectable min-h-0 flex-1 overflow-auto px-4 py-3">
        {turns.length === 0 && !busy && (
          <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
            Questions across every note — "what have I said about override rates?" Ask for
            something to be recorded and it will propose the change for review.
          </p>
        )}

        {turns.map((turn, ti) => (
          <div key={ti} className="mb-4">
            {turn.role === "user" ? (
              <p className="text-sm font-medium">{turn.text}</p>
            ) : (
              <>
                <p className="whitespace-pre-wrap text-sm">{turn.text}</p>

                {turn.read && turn.read.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {turn.read.map((p) => (
                      <button
                        key={p}
                        onClick={() => onOpenNote(p)}
                        className="rounded border px-1.5 py-0.5 text-[11px]"
                        style={{
                          borderColor: "var(--ink-border)",
                          color: "var(--ink-accent)",
                        }}
                      >
                        {p.replace(/^notes\//, "").replace(/\.md$/, "")}
                      </button>
                    ))}
                  </div>
                )}

                {turn === latest && !turn.proposals?.length && !busy && turn.text && (
                  <button
                    onClick={() => void capture()}
                    className="mt-2 rounded border px-1.5 py-0.5 text-[11px]"
                    style={{
                      borderColor: "var(--ink-border)",
                      color: "var(--ink-muted)",
                    }}
                    title="Let it decide: a new note, or added to an existing one"
                  >
                    Capture this…
                  </button>
                )}

                {turn.applied && (
                  <div className="mt-2 text-[11px]" style={{ color: "var(--ink-muted)" }}>
                    Applied {turn.applied.length} change
                    {turn.applied.length > 1 ? "s" : ""} · ⌘K → undo
                  </div>
                )}
              </>
            )}
          </div>
        ))}

        {busy && (
          <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
            Reading notes…
          </p>
        )}
        {error && (
          <p className="whitespace-pre-wrap text-sm" style={{ color: "#ef4444" }}>
            {error}
          </p>
        )}
      </div>

      {pending && (
        <div className="shrink-0 border-t" style={{ borderColor: "var(--ink-border)" }}>
          <div
            className="px-4 py-1.5 text-[11px] font-semibold tracking-wide"
            style={{ color: "var(--ink-muted)" }}
          >
            {pending.length} PROPOSED CHANGE{pending.length > 1 ? "S" : ""}
          </div>
          <div className="max-h-56 overflow-auto px-2 pb-2">
            {pending.map((p, i) => (
              <div key={i} className="mb-1">
                <div className="flex items-start gap-2 px-2 py-1 text-xs">
                  <button
                    onClick={() =>
                      setPicked((s) => {
                        const n = new Set(s);
                        n.has(i) ? n.delete(i) : n.add(i);
                        return n;
                      })
                    }
                    className="shrink-0 font-mono"
                    style={{
                      color: picked.has(i) ? "var(--ink-accent)" : "var(--ink-muted)",
                    }}
                  >
                    {picked.has(i) ? "[x]" : "[ ]"}
                  </button>
                  <button
                    onClick={() =>
                      setExpanded((s) => {
                        const n = new Set(s);
                        n.has(i) ? n.delete(i) : n.add(i);
                        return n;
                      })
                    }
                    className="min-w-0 flex-1 text-left"
                  >
                    <span style={{ color: p.destructive ? "#d97706" : "var(--ink-fg)" }}>
                      {p.destructive ? "~ " : "+ "}
                      {describe(p)}
                    </span>
                  </button>
                </div>
                {expanded.has(i) && (
                  <pre
                    className="mx-2 mb-1 overflow-x-auto whitespace-pre-wrap rounded px-2 py-1.5 text-[11px]"
                    style={{
                      background: "color-mix(in srgb, var(--ink-fg) 6%, transparent)",
                      color: "var(--ink-fg)",
                    }}
                  >
                    {detail(p)}
                  </pre>
                )}
              </div>
            ))}
          </div>
          <div
            className="flex items-center justify-between border-t px-4 py-2 text-[11px]"
            style={{ borderColor: "var(--ink-border)", color: "var(--ink-muted)" }}
          >
            <span>{picked.size} selected</span>
            <button
              onClick={apply}
              disabled={picked.size === 0}
              className="rounded px-2.5 py-1 text-xs"
              style={{
                background: picked.size ? "var(--ink-accent)" : "transparent",
                color: picked.size ? "white" : "var(--ink-muted)",
              }}
            >
              Apply {picked.size || ""}
            </button>
          </div>
        </div>
      )}

      <div className="shrink-0 border-t p-2" style={{ borderColor: "var(--ink-border)" }}>
        <textarea
          ref={input}
          value={question}
          rows={2}
          placeholder="Ask about your notes…"
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
            if (e.key === "Escape") onClose();
          }}
          className="w-full resize-none bg-transparent px-2 py-1 text-sm outline-none"
          style={{ color: "var(--ink-fg)" }}
        />
      </div>
    </aside>
  );
}

function describe(p: Proposal): string {
  const a = p.args;
  if (p.tool === "add_task") return `${a.target === "week" ? "This week" : "Backlog"}: ${a.text}`;
  if (p.tool === "create_note") return `New note: ${short(a.path)}`;
  if (p.tool === "append_to_note") return `${short(a.path)}: append`;
  if (p.tool === "replace_in_note") return `${short(a.path)}: replace text`;
  return p.tool;
}

function detail(p: Proposal): string {
  const a = p.args;
  const why = a.why ? `${a.why}\n\n` : "";
  if (p.tool === "replace_in_note") return `${why}- ${a.old}\n+ ${a.new}`;
  if (p.tool === "create_note") return `${why}${a.body ?? ""}`;
  if (p.tool === "append_to_note") return `${why}+ ${a.text}`;
  return `${why}+ ${a.text ?? ""}`;
}

function short(path = ""): string {
  return path.replace(/^notes\//, "").replace(/\.md$/, "");
}
