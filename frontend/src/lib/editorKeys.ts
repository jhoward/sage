/**
 * Editor commands, bound through the same table as every other shortcut.
 *
 * A CodeMirror `keymap` would be the obvious tool, but its keys are fixed when the editor
 * is built, and overrides arrive from the vault a moment later — so the first note opened
 * would keep the defaults. Matching at event time against `binding()` has no such window,
 * and it reuses `matches()`, so the rule that Ctrl is never Cmd holds here too.
 */

import { Prec, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { binding, matches, type BindingName } from "./keybindings";

export type EditorCommand = (view: EditorView) => boolean;

export function boundKeys(commands: Partial<Record<BindingName, EditorCommand>>): Extension {
  const entries = Object.entries(commands) as Array<[BindingName, EditorCommand]>;
  // High precedence so these beat the default markdown/editor bindings: ⌘⏎ is "insert
  // blank line" in the default keymap, and a handler that returns true stops it running.
  return Prec.high(
    EditorView.domEventHandlers({
      keydown(event, view) {
        for (const [name, run] of entries) {
          if (matches(event, binding(name))) return run(view);
        }
        return false;
      },
    }),
  );
}
