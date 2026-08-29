/**
 * The vault contract.
 *
 * Every component talks to the vault through this interface and never imports a
 * transport directly. Two adapters implement it — http.ts (the Python backend, now)
 * and tauri.ts (a Rust backend, later) — so swapping the backend touches one file.
 *
 * Keep this interface small and dumb. Wiki-link parsing, markdown rendering, and the
 * backlink index belong in the shared frontend, not behind this boundary; that is what
 * keeps a future Rust implementation to roughly a day of work.
 */

export interface FileNode {
  name: string;
  path: string; // vault-relative, POSIX separators
  isDir: boolean;
  children?: FileNode[];
}

export interface SearchHit {
  path: string;
  line: number;
  text: string;
}

export type SyncState = "ok" | "syncing" | "conflict" | "offline" | "error";

export interface SyncStatus {
  backend: string; // "local" now; "git" / "drive" later
  state: SyncState;
  detail: string;
  conflicts: string[];
}

export type TaskTarget = "week" | "backlog";

export interface TaskRef {
  path: string;
  line: number;
  text: string;
  section: string;
  rolled: number;
}

export interface RolloverResult {
  source: string | null;
  target: string;
  moved: string[];
  /** Rolled STALE_AFTER times or more — worth a do/delegate/drop decision. */
  stale: string[];
  skipped: number;
}

export interface WeekInfo {
  path: string;
  week: string; // the Sunday that starts it, e.g. "2026-08-23"
  label: string; // human form, e.g. "Aug 23 – 29"
  backlogs: string[]; // one now, one per project later
}

export type SkillContext = "selection" | "note" | "note-and-links" | "week-done";
export type SkillMode = "replace" | "insert" | "append";

export interface SkillInfo {
  id: string;
  title: string;
  context: SkillContext;
  mode: SkillMode;
  /** Vault path, so a skill can be opened and edited like any other note. */
  path: string;
  /** True if the skill needs a question typed before it runs. */
  asks?: boolean;
}

export interface SkillRunArgs {
  skill: string;
  notePath?: string | null;
  selection?: string | null;
  instruction?: string | null;
}

export interface Proposal {
  tool: "add_task" | "append_to_note" | "create_note" | "replace_in_note";
  args: Record<string, string>;
  /** A replacement loses the original; additive changes can be undone by deletion. */
  destructive: boolean;
}

export interface AskAnswer {
  text: string;
  proposals: Proposal[];
  /** Notes the model opened, for citation links. */
  read: string[];
}

export interface VaultBackend {
  /** `hidden` reveals `.occam/` — what "settings" means here. */
  listFiles(hidden?: boolean): Promise<{ files: FileNode[]; sync: SyncStatus }>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  search(query: string): Promise<SearchHit[]>;
  syncStatus(): Promise<SyncStatus>;

  /** This week's todo file, created on first access. */
  week(): Promise<WeekInfo>;
  /** Append a task. Target is the week by default. */
  quickAdd(text: string, target?: TaskTarget): Promise<{ path: string }>;
  /** Open tasks across every backlog file. */
  backlogTasks(): Promise<TaskRef[]>;
  /** Carry unfinished work into this week. Deterministic — no model involved. */
  rollover(): Promise<RolloverResult>;
  /** Lift a task out of one file and append it to another. */
  moveTask(source: string, line: number, target: string): Promise<void>;

  /** Delete a note. Confirmation is the caller's job. */
  deleteFile(path: string): Promise<void>;
  /** Move a note into archive/, keeping which folder it came from. Undoable. */
  archiveNote(path: string): Promise<{ path: string }>;
  /** Move a note and repoint every [[link]] that referenced it. */
  rename(path: string, newPath: string): Promise<{ newPath: string; updated: string[] }>;

  /** Where machine-local config lives, and whether a key is set. */
  config(): Promise<{ path: string; hasKey: boolean; keyFromEnv: boolean }>;
  /** Hand the config file to the OS default editor. */
  openConfig(): Promise<{ path: string }>;

  /** Skills are vault files, so this is re-read rather than cached. */
  skills(): Promise<{ skills: SkillInfo[]; available: boolean }>;
  /** Open an empty meeting note to take live notes in. */
  startMeeting(title?: string): Promise<{ path: string; title: string }>;
  /**
   * Paste a recap. When `path` is a meeting note the recap is appended to it, so live
   * notes and the recap end up in one note rather than two about one meeting.
   */
  meetingFromClipboard(path?: string | null): Promise<{
    path: string;
    title: string;
    followUpPrompt: string;
  }>;
  /** Ask a question across the whole vault. Reads run; writes come back as proposals. */
  ask(messages: Array<{ role: string; content: string }>): Promise<AskAnswer>;
  /** Apply accepted proposals. Snapshots the touched files so they can be undone. */
  applyProposals(proposals: Proposal[]): Promise<{ changed: string[] }>;
  /** Restore the files touched by the last applied batch. */
  undoLastChange(): Promise<{ restored: string[] }>;

  /** Restore a shipped skill to its default, discarding local edits. */
  resetSkill(id: string): Promise<void>;
  /** Streams generated text. The API key stays in the backend. */
  runSkill(args: SkillRunArgs, signal?: AbortSignal): AsyncIterable<string>;

  // Phase 3: runSkill(skill, selection): AsyncIterable<string>
}
