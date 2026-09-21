/**
 * Reference sheets in the split pane: the shortcut list and the markdown cheat sheet.
 *
 * A sheet is something you glance at — open, find the key, close — so one key does both.
 * Closing gives the pane back to whatever was there, because looking up a shortcut should
 * not cost you the backlog you had open beside the week.
 */

export const KEYS_SHEET = ".occam/keys.md";
export const MARKDOWN_SHEET = ".occam/markdown.md";
const SHEETS = [KEYS_SHEET, MARKDOWN_SHEET];

export interface SheetMove {
  /** What the split pane should show next; null closes it. */
  show: string | null;
  /** What to return to when the sheet is put away; null means "close the pane". */
  remember: string | null;
}

/**
 * @param current    what the split pane shows now (null if it is closed)
 * @param sheet      the sheet whose key was pressed
 * @param remembered what the pane held before a sheet took it over
 */
export function toggleSheet(
  current: string | null,
  sheet: string,
  remembered: string | null,
): SheetMove {
  // Already showing it: put it away, and give the pane back.
  if (current === sheet) return { show: remembered, remember: null };

  // Going from one sheet straight to the other keeps the *original* to return to,
  // rather than remembering a sheet as though it were your work.
  const fromSheet = current !== null && SHEETS.includes(current);
  return { show: sheet, remember: fromSheet ? remembered : current };
}
