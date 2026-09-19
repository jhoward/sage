/**
 * Syntax colours, drawn from the app's own tokens.
 *
 * CodeMirror's default highlight style hard-codes colours chosen for a white page — a
 * navy link, a dark red heading marker — and they turn to mud on a dark one. Pointing
 * every tag at a CSS variable instead means the palette follows the system appearance
 * with the rest of the app, and there is still no theme to pick.
 *
 * Deliberately few colours. Live preview already carries the structure (size, weight,
 * hidden markers); colour only has to say "this is a link" and "this is syntax".
 */

import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

export const inkHighlight = HighlightStyle.define([
  { tag: t.heading, fontWeight: "650" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.link, t.url], color: "var(--ink-accent)" },
  { tag: t.monospace, color: "var(--ink-code)" },
  { tag: t.quote, color: "var(--ink-muted)" },
  // The markdown's own punctuation: #, **, -, >, ```, and the rule.
  {
    tag: [t.processingInstruction, t.meta, t.contentSeparator, t.comment],
    color: "var(--ink-muted)",
  },
  // Fenced code, where a language is loaded for it.
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: "var(--ink-accent)" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "var(--ink-code)" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--ink-code)" },
  { tag: t.invalid, color: "var(--ink-danger)" },
]);
