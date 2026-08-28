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

export interface WeekInfo {
  path: string;
  week: string; // e.g. "2026-W35"
  backlogs: string[]; // one now, one per project later
}

export interface VaultBackend {
  listFiles(): Promise<{ files: FileNode[]; sync: SyncStatus }>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  search(query: string): Promise<SearchHit[]>;
  syncStatus(): Promise<SyncStatus>;

  /** This week's todo file, created on first access. */
  week(): Promise<WeekInfo>;
  /** Append a task under `## Inbox` with no decisions at capture time. */
  quickAdd(text: string): Promise<{ path: string }>;

  // Phase 3: runSkill(skill, selection): AsyncIterable<string>
}
