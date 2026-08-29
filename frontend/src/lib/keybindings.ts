/**
 * Every global shortcut, declared in one place.
 *
 * Two rules this file exists to enforce:
 *
 * 1. **Never treat Ctrl as an alias for Cmd on macOS.** The emacs/readline bindings
 *    (⌃A, ⌃E, ⌃K, ⌃N, ⌃P, ⌃D…) work in every macOS text field, and accepting
 *    `metaKey || ctrlKey` silently eats them — ⌃K stops killing to end of line and opens
 *    a palette instead. On macOS "Mod" means Cmd and nothing else; elsewhere it means Ctrl.
 *
 * 2. **Do not shadow a text-editing binding people rely on.** A shortcut is not free just
 *    because nothing in *this* app uses it.
 *
 * Phase 4 loads overrides from `<vault>/.occam/keybindings.toml`; having the table here is
 * what makes that a small change.
 */

/**
 * Checked lazily rather than captured at module load: a value frozen at import time is
 * invisible to tests and awkward to reason about.
 */
export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /Mac|iPhone|iPad/.test(ua.userAgentData?.platform ?? navigator.platform ?? "");
}

export interface KeySpec {
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

/**
 * Does this event match the spec?
 *
 * The Ctrl/Cmd asymmetry is the whole point: on macOS a bare ⌃K must NOT match `Mod-k`.
 */
export function matches(e: KeyboardEvent, spec: KeySpec): boolean {
  const mac = isMac();
  const modDown = mac ? e.metaKey : e.ctrlKey;
  // On macOS, Ctrl belongs to the text layer; a shortcut asking for Mod must not fire
  // when Ctrl is what is held.
  const wrongMod = mac ? e.ctrlKey : e.metaKey;

  if (!!spec.mod !== modDown) return false;
  if (wrongMod) return false;
  if (!!spec.shift !== e.shiftKey) return false;
  if (!!spec.alt !== e.altKey) return false;

  return e.key.toLowerCase() === spec.key.toLowerCase();
}

export const BINDINGS = {
  palette: { key: "k", mod: true },
  switcher: { key: "o", mod: true },
  newNote: { key: "n", mod: true },
  search: { key: "f", mod: true, shift: true },
  quickAdd: { key: "t", mod: true, shift: true },
  split: { key: "\\", mod: true },
  // ⌘⌫ is the macOS idiom for "move to trash"; the confirmation still asks for the name.
  deleteNote: { key: "Backspace", mod: true },
  pull: { key: "p", mod: true, shift: true },
  ask: { key: "j", mod: true },
} satisfies Record<string, KeySpec>;

export type BindingName = keyof typeof BINDINGS;

/** Human label for the footer, e.g. "⌘⇧F" or "Ctrl+Shift+F". */
export function label(spec: KeySpec): string {
  const key = spec.key === "\\" ? "\\" : spec.key.toUpperCase();
  return isMac()
    ? `${spec.mod ? "⌘" : ""}${spec.shift ? "⇧" : ""}${spec.alt ? "⌥" : ""}${key}`
    : [spec.mod && "Ctrl", spec.shift && "Shift", spec.alt && "Alt", key]
        .filter(Boolean)
        .join("+");
}
