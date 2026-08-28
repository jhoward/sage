/** VaultBackend over HTTP, talking to the Python backend. */

import type {
  FileNode,
  SearchHit,
  SyncStatus,
  VaultBackend,
  WeekInfo,
} from "./types";

/**
 * In dev the page is served by Vite on 5173 while the API is on a random free port,
 * passed through as ?api=<port>. In the packaged app both are the same origin.
 */
function apiBase(): string {
  const port = new URLSearchParams(window.location.search).get("api");
  return port ? `http://127.0.0.1:${port}` : "";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

export const httpBackend: VaultBackend = {
  async listFiles() {
    return request<{ files: FileNode[]; sync: SyncStatus }>("/api/files");
  },

  async readFile(path) {
    const r = await request<{ content: string }>(
      `/api/file?path=${encodeURIComponent(path)}`,
    );
    return r.content;
  },

  async writeFile(path, content) {
    await request("/api/file", {
      method: "PUT",
      body: JSON.stringify({ path, content }),
    });
  },

  async search(query) {
    const r = await request<{ hits: SearchHit[] }>(
      `/api/search?q=${encodeURIComponent(query)}`,
    );
    return r.hits;
  },

  async syncStatus() {
    return request<SyncStatus>("/api/sync");
  },

  async week() {
    return request<WeekInfo>("/api/todo/week");
  },

  async quickAdd(text, target = "week") {
    return request<{ path: string }>("/api/todo/quick-add", {
      method: "POST",
      body: JSON.stringify({ text, target }),
    });
  },
};
