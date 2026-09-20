/**
 * The frontmatter block, rendered as a header.
 *
 * Week files, the backlog, meeting notes and skills all open with YAML between `---`
 * lines. Raw, it is the ugliest thing in the file, and for a reason that is not obvious:
 * markdown has no frontmatter, so `dates: Sep 13 – 19` followed by `---` parses as a
 * setext *heading* and comes out bold.
 *
 * Same trick as the rest of live preview, one block at a time: the header is drawn while
 * the cursor is elsewhere, and the raw lines come back the moment it moves in — by click
 * or by arrowing up. The file is untouched, so everything that reads `week:` still can.
 *
 * A StateField rather than a ViewPlugin because the replacement spans line breaks, and
 * CodeMirror only accepts block decorations from state.
 */

import { StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";

export interface Frontmatter {
  /** Offset of the end of the closing `---` line. */
  to: number;
  /** Line number of the closing `---`. */
  lastLine: number;
  fields: Record<string, string>;
}

// Far enough for any header written by hand, and a bound on the scan for a note that
// merely opens with a horizontal rule and never closes it.
const MAX_LINES = 40;

export function parseFrontmatter(state: EditorState): Frontmatter | null {
  const { doc } = state;
  if (doc.lines < 2 || doc.line(1).text.trim() !== "---") return null;

  const fields: Record<string, string> = {};
  for (let n = 2; n <= Math.min(doc.lines, MAX_LINES); n++) {
    const text = doc.line(n).text;
    if (text.trim() === "---") return { to: doc.line(n).to, lastLine: n, fields };
    const m = /^([\w-]+):\s*(.*)$/.exec(text);
    if (m) fields[m[1]] = m[2].trim();
  }
  return null;
}

/** Where the note proper begins: the first line after the frontmatter and its blank line. */
export function bodyStart(state: EditorState): number {
  const fm = parseFrontmatter(state);
  if (!fm) return 0;
  let n = fm.lastLine + 1;
  if (n <= state.doc.lines && !state.doc.line(n).text.trim()) n += 1;
  return n <= state.doc.lines ? state.doc.line(n).from : state.doc.length;
}

/** "2026-09-19" as "Sep 19, 2026". Anything else is shown as written. */
function prettyDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return value;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * The week number for a week file's `week:` date, with the year that number belongs to.
 *
 * Weeks here start on Sunday and ISO weeks on Monday, so the number is the ISO week of the
 * Monday that follows — the inverse of how the backend turned the old `2026-W35.md` names
 * into Sunday dates, so a week shows the number it always had. The year is the ISO year,
 * which is not always the date's own: the week of Sunday Dec 27, 2026 is week 53 of 2026,
 * and the one after it is week 1 of 2027.
 *
 * In UTC throughout, so a daylight-saving shift cannot make a week 6.96 days long.
 */
export function weekNumber(value: string): { week: number; year: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const DAY = 86_400_000;
  const sunday = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(sunday)) return null;

  // An ISO week belongs to the year its Thursday falls in, and week 1 is the week
  // containing January 4th.
  const monday = sunday + DAY;
  const thursday = new Date(monday + 3 * DAY);
  const year = thursday.getUTCFullYear();
  const jan4 = Date.UTC(year, 0, 4);
  const firstMonday = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY;
  return { week: Math.round((monday - firstMonday) / (7 * DAY)) + 1, year };
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * What to show: a small line above, and a title.
 *
 * Driven by which fields are present rather than by file path, so a note you give a
 * `title:` to gets the same treatment as one the app wrote.
 */
export function headerFor(fields: Record<string, string>): { overline: string; title: string } {
  const { week, dates, kind, title, date, ...rest } = fields;

  if (week || dates) {
    // The file says `week: 2026-09-13`, a date, because a date sorts and names the file.
    // What a person wants to read is the number, so that is what is drawn.
    const n = weekNumber(week ?? "");
    const overline = n ? `Week ${n.week} · ${n.year}` : "Week";
    return { overline, title: dates || week };
  }
  if (kind === "backlog") return { overline: "", title: "Backlog" };

  const about = [
    kind && capitalise(kind),
    date && prettyDate(date),
    ...Object.entries(rest).map(([k, v]) => `${k} ${v}`),
  ].filter(Boolean);
  return { overline: about.join(" · "), title: title ?? "" };
}

class HeaderWidget extends WidgetType {
  readonly overline: string;
  readonly title: string;
  constructor(overline: string, title: string) {
    super();
    this.overline = overline;
    this.title = title;
  }
  eq(other: HeaderWidget) {
    return other.overline === this.overline && other.title === this.title;
  }
  toDOM() {
    const box = document.createElement("div");
    box.className = "cm-fm";
    box.title = "Click to edit";
    for (const [cls, text] of [
      ["cm-fm-overline", this.overline],
      ["cm-fm-title", this.title],
    ]) {
      if (!text) continue;
      const el = document.createElement("div");
      el.className = cls;
      el.textContent = text;
      box.appendChild(el);
    }
    return box;
  }
  // Let the click through: it puts the cursor in the block, which is what reveals it.
  ignoreEvent() {
    return false;
  }
}

const rawLine = Decoration.line({ class: "cm-fm-raw" });

function build(state: EditorState): DecorationSet {
  const fm = parseFrontmatter(state);
  if (!fm) return Decoration.none;

  const editing = state.selection.ranges.some((r) => r.from <= fm.to);
  if (editing) {
    // Raw, but quiet — and with the accidental setext heading's bold taken back off.
    const lines: Range<Decoration>[] = [];
    for (let n = 1; n <= fm.lastLine; n++) lines.push(rawLine.range(state.doc.line(n).from));
    return Decoration.set(lines);
  }

  const { overline, title } = headerFor(fm.fields);
  if (!overline && !title) return Decoration.none;
  return Decoration.set([
    Decoration.replace({ widget: new HeaderWidget(overline, title), block: true }).range(0, fm.to),
  ]);
}

export const frontmatterExtension = StateField.define<DecorationSet>({
  create: build,
  update(value, tr) {
    return tr.docChanged || tr.selection ? build(tr.state) : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
