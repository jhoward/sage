/**
 * Renders `[[links]]` as clickable, and marks the ones that do not resolve.
 *
 * An unresolved link is styled differently rather than hidden: in a vault you are actively
 * writing, a link to a note that does not exist yet is a normal state, and seeing it is
 * the point.
 */

import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import type { FileNode } from "../backend";
import { parseLinks, resolveLink } from "./wikilinks";

/** The file tree, so links can be resolved as it changes. */
export const setLinkFiles = StateEffect.define<FileNode[]>();

export const linkFilesField = StateField.define<FileNode[]>({
  create: () => [],
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setLinkFiles)) return e.value;
    return value;
  },
});

const resolved = Decoration.mark({ class: "cm-wikilink" });
const broken = Decoration.mark({ class: "cm-wikilink cm-wikilink-broken" });

function build(view: EditorView): DecorationSet {
  const files = view.state.field(linkFilesField, false) ?? [];
  const builder = new RangeSetBuilder<Decoration>();

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      for (const link of parseLinks(line.text)) {
        builder.add(
          line.from + link.from,
          line.from + link.to,
          resolveLink(link.target, files) ? resolved : broken,
        );
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

export function wikilinkExtension(
  onOpen: (path: string) => void,
  onCreate?: (name: string) => void,
) {
  const decorations = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(u: ViewUpdate) {
        if (
          u.docChanged ||
          u.viewportChanged ||
          u.startState.field(linkFilesField, false) !==
            u.state.field(linkFilesField, false)
        ) {
          this.decorations = build(u.view);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );

  // Cmd/Ctrl-click follows a link, matching how editors treat go-to-definition. A plain
  // click still places the cursor, so links stay editable text.
  const click = EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!event.metaKey && !event.ctrlKey) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) return false;

      const line = view.state.doc.lineAt(pos);
      const offset = pos - line.from;
      const link = parseLinks(line.text).find(
        (l) => offset >= l.from && offset <= l.to,
      );
      if (!link) return false;

      const files = view.state.field(linkFilesField, false) ?? [];
      const target = resolveLink(link.target, files);

      event.preventDefault();
      // An unresolved link is an invitation: ⌘-clicking it creates the note. That is how
      // a wiki is meant to feel — you write the link first and the page follows.
      if (target) onOpen(target);
      else onCreate?.(link.target);
      return true;
    },
  });

  return [linkFilesField, decorations, click];
}
