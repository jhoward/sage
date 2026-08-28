/**
 * Provenance markers.
 *
 * Six months on, "did I verify this, or did a model assert it?" is the most important
 * question about any line in a vault, and no pre-AI notes app has the concept because
 * everything in one was human-written by definition.
 *
 * HTML comments because they are invisible in every markdown renderer and survive
 * round-tripping through Obsidian, `grep`, or any other editor — which is what keeps the
 * "plain files, fully portable" promise intact.
 */

export interface Provenance {
  model: string;
  skill: string;
  at: string;
}

const OPEN_RE = /<!--\s*sage:ai\s+([^>]*?)-->/;
const CLOSE = "<!-- /sage:ai -->";

export function wrap(text: string, p: Provenance): string {
  const open = `<!-- sage:ai model=${p.model} skill=${p.skill} at=${p.at} -->`;
  // Strip any markers already in the text before wrapping. Running a skill on generated
  // text used to nest a fresh pair around the old ones, stacking a marker per pass. The
  // useful fact is "a model touched this", not the full lineage — one pair says that.
  return `${open}\n${strip(text).trim()}\n${CLOSE}`;
}

/** Parse the attributes of an opening marker, if the line has one. */
export function parseMarker(line: string): Provenance | null {
  const m = OPEN_RE.exec(line);
  if (!m) return null;

  const attrs: Record<string, string> = {};
  for (const pair of m[1].trim().split(/\s+/)) {
    const [k, ...rest] = pair.split("=");
    if (k && rest.length) attrs[k] = rest.join("=");
  }
  return {
    model: attrs.model ?? "unknown",
    skill: attrs.skill ?? "unknown",
    at: attrs.at ?? "",
  };
}

export function isOpenMarker(line: string): boolean {
  return OPEN_RE.test(line);
}

export function isCloseMarker(line: string): boolean {
  return line.trim() === CLOSE;
}

/** Strip every marker, leaving the generated prose. Used when accepting as "mine". */
export function strip(text: string): string {
  return text
    .split("\n")
    .filter((l) => !isOpenMarker(l) && !isCloseMarker(l))
    .join("\n");
}
