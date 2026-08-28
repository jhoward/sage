/**
 * The command registry.
 *
 * One invocation surface: ⌘K takes intent, and a built-in command and a vault skill are
 * the same kind of thing. That is why commands are *data* rather than a switch statement —
 * in Phase 3, skills loaded from `.sage/skills/*.md` join this same list and appear in the
 * palette alongside everything else, with no changes to the palette itself.
 */

export interface Command {
  id: string;
  title: string;
  /** Extra words to match on, so "new" finds "Create note". */
  keywords?: string;
  /** Shown right-aligned: a shortcut, a path, whatever identifies the target. */
  hint?: string;
  run: () => void | Promise<void>;
}

/**
 * Subsequence match, the way editors do it: "sfb" matches "Send to backlog".
 * Returns a score (lower is better) or null when it does not match at all.
 */
export function score(query: string, command: Command): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;

  const haystack = `${command.title} ${command.keywords ?? ""}`.toLowerCase();

  // A contiguous hit is always better than a scattered one.
  const direct = haystack.indexOf(q);
  if (direct !== -1) return direct;

  let at = 0;
  let gaps = 0;
  for (const ch of q) {
    const found = haystack.indexOf(ch, at);
    if (found === -1) return null;
    gaps += found - at;
    at = found + 1;
  }
  return 1000 + gaps; // ranked below every contiguous match
}

export function filterCommands(query: string, commands: Command[]): Command[] {
  return commands
    .map((c) => ({ c, s: score(query, c) }))
    .filter((x): x is { c: Command; s: number } => x.s !== null)
    .sort((a, b) => a.s - b.s)
    .map((x) => x.c);
}
