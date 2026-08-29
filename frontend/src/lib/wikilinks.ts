/**
 * Wiki-link parsing and resolution.
 *
 * Deliberately frontend-only. The backend stays six dumb operations — list, read, write,
 * search — and every bit of markdown intelligence lives here, which is what keeps a future
 * Rust backend to about a day of work.
 *
 * Backlinks are built on the existing search() rather than a new endpoint or an index:
 * search for `[[name`, then re-parse each hit to confirm the link really resolves here.
 * No index means nothing to rebuild and nothing to go stale.
 */

import type { FileNode } from "../backend";

export interface WikiLink {
  /** The note being linked to, before any pipe. */
  target: string;
  /** Display text after a pipe, if given. */
  alias?: string;
  from: number;
  to: number;
}

const LINK_RE = /\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]/g;

export function parseLinks(text: string): WikiLink[] {
  const out: WikiLink[] = [];
  for (const m of text.matchAll(LINK_RE)) {
    const target = m[1].trim();
    if (!target) continue;
    out.push({
      target,
      alias: m[2]?.trim() || undefined,
      from: m.index!,
      to: m.index! + m[0].length,
    });
  }
  return out;
}

export function flattenFiles(nodes: FileNode[], out: FileNode[] = []): FileNode[] {
  for (const n of nodes) {
    if (n.isDir) flattenFiles(n.children ?? [], out);
    else out.push(n);
  }
  return out;
}

function stem(path: string): string {
  return path.split("/").pop()!.replace(/\.md$/i, "");
}

/**
 * Resolve a link target to a vault path.
 *
 * Tries, in order: exact path, path with .md appended, then a unique basename match.
 * Basename matching is last because it is the ambiguous one — two notes can share a name
 * in different folders, and silently picking one would be worse than not resolving.
 */
export function resolveLink(target: string, files: FileNode[]): string | null {
  const all = flattenFiles(files);
  const needle = target.replace(/\.md$/i, "").toLowerCase();

  const exact = all.find((f) => f.path.toLowerCase() === `${needle}.md`);
  if (exact) return exact.path;

  const byStem = all.filter((f) => stem(f.path).toLowerCase() === needle);
  if (byStem.length === 1) return byStem[0].path;

  return null;
}

/** The name other notes would use to link here. */
export function linkNameFor(path: string): string {
  return stem(path);
}

/**
 * Does this line actually link to `path`? Used to filter raw search hits, since a literal
 * search for `[[name` also matches `[[name-something-else]]`.
 */
export function lineLinksTo(line: string, path: string, files: FileNode[]): boolean {
  return parseLinks(line).some((l) => resolveLink(l.target, files) === path);
}

/**
 * One path segment to a filename. Keeps unicode letters — notes are personal, not URLs —
 * and only collapses what would be awkward in a filename.
 */
function slugSegment(name: string): string {
  return name
    .trim()
    .replace(/\.md$/i, "")
    .replace(/[\\:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * A typed name to a vault-relative path, slugifying each segment separately.
 *
 * Slashes are kept, so "governance/vendor risk" becomes "governance/vendor-risk" and the
 * folder comes into being by having a file written into it. That is how the filesystem
 * already works, and it is why there is no "new folder" command: a folder with nothing in
 * it is not a thing this app has any use for.
 */
export function slugify(name: string): string {
  return name
    .split("/")
    .map(slugSegment)
    // Drop "." and ".." outright. The backend refuses traversal anyway, but a path that
    // cannot mean anything should not reach it and come back as an error.
    .filter((seg) => seg && !/^\.+$/.test(seg))
    .join("/");
}
