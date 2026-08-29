/** VaultBackend over HTTP, talking to the Python backend. */

import type {
  AskAnswer,
  FileNode,
  RolloverResult,
  SearchHit,
  SkillInfo,
  SyncStatus,
  TaskRef,
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
  async listFiles(hidden = false) {
    return request<{ files: FileNode[]; sync: SyncStatus }>(
      `/api/files${hidden ? "?hidden=true" : ""}`,
    );
  },

  async deleteFile(path) {
    await request(`/api/file?path=${encodeURIComponent(path)}`, {
      method: "DELETE",
    });
  },

  async archiveNote(path) {
    return request<{ path: string }>("/api/archive", {
      method: "POST",
      body: JSON.stringify({ path }),
    });
  },

  async renameFolder(path, newPath) {
    return request<{ moved: string[] }>("/api/rename-folder", {
      method: "POST",
      body: JSON.stringify({ path, newPath }),
    });
  },

  async rename(path, newPath, title) {
    return request<{ newPath: string; updated: string[] }>("/api/rename", {
      method: "POST",
      body: JSON.stringify({ path, newPath, title: title ?? null }),
    });
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

  async backlogTasks() {
    const r = await request<{ tasks: TaskRef[] }>("/api/todo/backlog");
    return r.tasks;
  },

  async rollover() {
    return request<RolloverResult>("/api/todo/rollover", { method: "POST" });
  },

  async moveTask(source, line, target) {
    await request("/api/todo/move", {
      method: "POST",
      body: JSON.stringify({ source, line, target }),
    });
  },

  async config() {
    return request<{ path: string; hasKey: boolean; keyFromEnv: boolean }>(
      "/api/config",
    );
  },

  async openConfig() {
    return request<{ path: string }>("/api/config/open", { method: "POST" });
  },

  async skills() {
    return request<{ skills: SkillInfo[]; available: boolean }>("/api/skills");
  },

  async startMeeting(title = "") {
    return request<{ path: string; title: string }>("/api/meeting/start", {
      method: "POST",
      body: JSON.stringify({ title }),
    });
  },

  async meetingFromClipboard(path) {
    return request<{ path: string; title: string; followUpPrompt: string }>(
      "/api/meeting",
      { method: "POST", body: JSON.stringify({ path: path ?? null }) },
    );
  },

  async keybindings(defaults) {
    return request<{
      overrides: Record<string, { key: string; mod?: boolean; shift?: boolean; alt?: boolean }>;
      problems: string[];
    }>("/api/keybindings", { method: "POST", body: JSON.stringify({ defaults }) });
  },

  async editKeybindings(defaults) {
    return request<{ path: string }>("/api/keybindings/edit", {
      method: "POST",
      body: JSON.stringify({ defaults }),
    });
  },

  async ask(messages) {
    return request<AskAnswer>("/api/chat", {
      method: "POST",
      body: JSON.stringify({ messages }),
    });
  },

  async applyProposals(proposals) {
    return request<{ changed: string[] }>("/api/chat/apply", {
      method: "POST",
      body: JSON.stringify({ proposals }),
    });
  },

  async undoLastChange() {
    return request<{ restored: string[] }>("/api/chat/undo", { method: "POST" });
  },

  async resetSkill(id) {
    await request(`/api/skills/${encodeURIComponent(id)}/reset`, { method: "POST" });
  },

  /**
   * Server-sent events, read off the response body.
   *
   * EventSource cannot POST, and a skill run needs a body, so the stream is parsed by
   * hand. Errors arrive as an `error` event rather than an HTTP status: once the first
   * byte is out the status is already committed.
   */
  async *runSkill(args, signal) {
    const res = await fetch(`${apiBase()}/api/skills/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
      signal,
    });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    if (!res.body) throw new Error("no response body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line; a partial frame stays buffered.
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        let event = "message";
        let data = "";
        for (const line of frame.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (!data) continue;

        const payload = JSON.parse(data);
        if (event === "chunk") yield payload.text as string;
        else if (event === "error") throw new Error(payload.message);
        else if (event === "done") return;
      }
    }
  },
};
