/**
 * The rules for dragging a note in the file tree, kept apart from the DOM so they can be
 * tested as plain functions.
 *
 * Dragging is a third way to reach the existing move — the same backend call as the
 * "Move…" prompt, which is what rewrites inbound [[links]]. Nothing here moves a file.
 */

/**
 * Folders the app finds things in by path. A week file dragged out of `todo/` would not
 * error — rollover would simply never see it again — so these are closed in both
 * directions rather than trusted to be left alone.
 */
const LOCKED = ["todo", ".occam", ".sage"];

const folderOf = (path: string) => path.split("/").slice(0, -1).join("/");
const locked = (path: string) => LOCKED.includes(path.split("/")[0]);

/** Only notes drag. A folder dropped into a folder is how a tree gets deep. */
export function canDrag(node: { path: string; isDir: boolean }): boolean {
  return !node.isDir && !locked(node.path);
}

/**
 * The folder a drop on `target` means. Dropping on a note means "beside that note", so
 * nobody has to aim at a folder's one thin row to file something in it.
 */
export function dropFolder(target: { path: string; isDir: boolean }): string {
  return target.isDir ? target.path : folderOf(target.path);
}

/**
 * Where `source` would end up if dropped on `target`, or null if the drop means nothing:
 * a locked folder, the vault root, or the folder the note is already in.
 */
export function moveTarget(
  source: string,
  target: { path: string; isDir: boolean },
): string | null {
  const folder = dropFolder(target);
  if (!folder || locked(folder) || locked(source)) return null;
  if (folder === folderOf(source)) return null;
  return `${folder}/${source.split("/").pop()}`;
}
