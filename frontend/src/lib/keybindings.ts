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
  // An unbound command matches nothing until someone gives it a key.
  if (!spec.key) return false;

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

/**
 * The tiering rule: **⌘ alone means you do it many times a day.** Everything else takes
 * shift. Promotion is the signal that a command is core, so the set of unshifted keys
 * stays small enough to be worth memorising.
 *
 * Peers share a tier — "new note", "new task" and "new meeting" are the same kind of
 * action at the same frequency, so N/T/M are siblings rather than one being promoted and
 * the others not.
 */
export const BINDINGS = {
  palette: { key: "k", mod: true },
  switcher: { key: "o", mod: true },
  newNote: { key: "n", mod: true },
  search: { key: "f", mod: true, shift: true },
  quickAdd: { key: "t", mod: true },
  split: { key: "\\", mod: true },
  // ⌘⌫ is the macOS idiom for "move to trash".
  deleteNote: { key: "Backspace", mod: true },
  pull: { key: "p", mod: true, shift: true },
  ask: { key: "j", mod: true },
  meeting: { key: "v", mod: true, shift: true },
  // ⌘M is Minimize on macOS. Taken deliberately: a single-window app is rarely minimised,
  // and keeping the three "new" verbs together is worth more than the system default.
  startMeeting: { key: "m", mod: true },

  // Bindable but unbound by default. Listed so the keybindings file can show everything
  // you *could* bind rather than only what is already bound — the discoverability problem
  // with a sparse settings file. An empty key never matches.
  // ⌘[ / ⌘] are the macOS back/forward (Safari, Finder, Preview, Mail). CodeMirror binds
  // them to outdent/indent, which is a VS Code convention rather than a platform one, so
  // the platform wins here.
  back: { key: "[", mod: true },
  forward: { key: "]", mod: true },
  // ⌘B must stay Bold in a markdown editor, so the sidebar takes ⌘⇧B.
  sidebar: { key: "b", mod: true, shift: true },
  // The shortcut for finding shortcuts has to be the one people already try.
  keys: { key: "/", mod: true },
  // ⌘, opens settings in every macOS app, so it does here.
  settings: { key: ",", mod: true },

  // Editor commands. These used to live in a private CodeMirror keymap, which kept them
  // out of the palette, the key sheet and the keybindings file — so the most-used keys in
  // the app were the only ones written down nowhere. They act on the line under the
  // cursor, and only fire while an editor has focus.
  toggleTask: { key: "Enter", mod: true },
  // Shift undoes, as ⇧⇥ undoes ⇥.
  untask: { key: "Enter", mod: true, shift: true },
  // ⌥⇧↑ rather than ⌘⇧↑: the latter is "extend selection to the start of the document"
  // on macOS, which is worth more than a task shortcut. It also pairs — ⌥↑ nudges one
  // line, ⌥⇧↑ goes all the way.
  promote: { key: "ArrowUp", alt: true, shift: true },
  lineUp: { key: "ArrowUp", alt: true },
  lineDown: { key: "ArrowDown", alt: true },
  deleteLine: { key: "k", mod: true, shift: true },
  hideDone: { key: "h", mod: true, shift: true },
  bold: { key: "b", mod: true },
  italic: { key: "i", mod: true },

  rollover: { key: "", mod: true },
  archiveNote: { key: "", mod: true },
  moveNote: { key: "", mod: true },
  renameNote: { key: "", mod: true },
  undo: { key: "", mod: true },
  cheatsheet: { key: "", mod: true },
  settingsFolder: { key: "", mod: true },
  backlog: { key: "", mod: true },
  week: { key: "", mod: true },
} satisfies Record<string, KeySpec>;

export type BindingName = keyof typeof BINDINGS;

/**
 * Overrides read from `<vault>/.occam/keybindings.toml`, merged over the defaults.
 *
 * Module-level rather than React state because `matches()` is called from event handlers
 * all over the app; threading a context through every one of them to change a value that
 * loads once at startup would be ceremony for nothing.
 */
let overrides: Partial<Record<string, KeySpec>> = {};

export function applyOverrides(next: Partial<Record<string, KeySpec>>): void {
  overrides = next ?? {};
}

/** The binding in force for a command: an override if there is one, else the default. */
export function binding(name: BindingName): KeySpec {
  return (overrides[name] as KeySpec | undefined) ?? BINDINGS[name];
}

/** Named keys, as the glyphs macOS menus use for them. */
const GLYPHS: Record<string, string> = {
  enter: "⏎",
  backspace: "⌫",
  tab: "⇥",
  escape: "esc",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
};

/** Human label for the footer, e.g. "⌘⇧F" or "Ctrl+Shift+F". */
export function label(spec: KeySpec): string {
  const mac = isMac();
  const named = GLYPHS[spec.key.toLowerCase()];
  const key = mac && named ? named : spec.key.length > 1 ? spec.key : spec.key.toUpperCase();
  return mac
    ? // ⌥ before ⇧, so ⌥⇧↑ reads the way it is written everywhere else.
      `${spec.mod ? "⌘" : ""}${spec.alt ? "⌥" : ""}${spec.shift ? "⇧" : ""}${key}`
    : [spec.mod && "Ctrl", spec.shift && "Shift", spec.alt && "Alt", key]
        .filter(Boolean)
        .join("+");
}

/**
 * What each command is, in the words the key sheet uses.
 *
 * Kept beside BINDINGS, and a test fails if a binding is missing from it — the sheet
 * cannot fall behind the table the way a hand-written list did.
 */
export const SHEET: Array<{ group: string; keys: Array<[BindingName, string]> }> = [
  {
    group: "Tasks",
    keys: [
      ["toggleTask", "Make this line a task, or check it off (again to uncheck)"],
      ["untask", "Turn a task back into an ordinary line"],
      ["quickAdd", "Add a task from anywhere"],
      ["promote", "Move this line to the top of its section"],
      ["lineUp", "Nudge this line up"],
      ["lineDown", "Nudge this line down"],
      ["hideDone", "Hide or show completed tasks"],
      ["pull", "Pull tasks from the backlog"],
      ["week", "Open this week"],
      ["backlog", "Open the backlog"],
      ["rollover", "Roll unfinished work into this week"],
    ],
  },
  {
    group: "Writing",
    keys: [
      ["bold", "Bold"],
      ["italic", "Italic"],
      ["deleteLine", "Delete this line"],
      ["undo", "Undo the last AI change"],
    ],
  },
  {
    group: "Find and create",
    keys: [
      ["palette", "Every command, by name"],
      ["switcher", "Open a note"],
      ["search", "Search the vault"],
      ["newNote", "New note"],
      ["startMeeting", "Start a meeting note"],
      ["meeting", "Paste a meeting recap"],
      ["ask", "Ask the vault"],
    ],
  },
  {
    group: "This note",
    keys: [
      ["renameNote", "Rename (updates links)"],
      ["moveNote", "Move to another folder"],
      ["archiveNote", "Archive"],
      ["deleteNote", "Delete"],
    ],
  },
  {
    group: "View",
    keys: [
      ["keys", "This sheet"],
      ["cheatsheet", "Markdown cheat sheet"],
      ["split", "Split pane"],
      ["sidebar", "Show or hide the sidebar"],
      ["back", "Back"],
      ["forward", "Forward"],
      ["settings", "Settings"],
      ["settingsFolder", "Show or hide the settings folder in the sidebar"],
    ],
  },
];

/**
 * Gestures that are not bindings: they belong to the text layer, and rebinding Enter is
 * not a thing anyone should be offered. Listed so the sheet is the whole answer.
 */
const FIXED: Array<[string, string]> = [
  ["⏎", "Continue a list; on an empty item, leave it"],
  ["⇥", "Indent a list item under the one above"],
  ["⇧⇥", "Outdent a list item"],
  ["click", "Check or uncheck a task's box"],
];

/** The key sheet as markdown, reflecting whatever overrides are in force right now. */
export function renderKeySheet(): string {
  const out = [
    "# Keyboard shortcuts",
    "",
    "Generated each time it is opened, so edits here do not stick. To change a key, run",
    "**Edit keybindings** from the palette.",
  ];
  const unbound: string[] = [];

  for (const { group, keys } of SHEET) {
    const rows = [];
    for (const [name, what] of keys) {
      const spec = binding(name);
      if (spec.key) rows.push(`- \`${label(spec)}\` ${what}`);
      else unbound.push(`- ${what} — \`${name}\``);
    }
    if (rows.length) out.push("", `## ${group}`, ...rows);
  }

  out.push("", "## In a list", ...FIXED.map(([key, what]) => `- \`${key}\` ${what}`));
  if (unbound.length) {
    out.push("", "## No key yet", "Give one a key in the keybindings file.", ...unbound);
  }
  return out.join("\n") + "\n";
}
