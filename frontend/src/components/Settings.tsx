import { useEffect, useState } from "react";
import { backend } from "../backend";
import { describeSync } from "./SyncIndicator";
import type {
  RemoteCheck,
  Settings as SettingsData,
  SettingsChanges,
  SkillInfo,
} from "../backend";

/**
 * The settings screen.
 *
 * One screen, in sections, that scrolls — so there is one place to look, and the answer
 * to "where is that setting" is never "which kind of setting is it". What would make it
 * grow without limit stays out: skills and keybindings are files, and this only points
 * at them. A setting here is a value; anything with a body is a file.
 *
 * Nothing is applied until Save, because two of these fields are a path and a remote,
 * and neither should take effect half-typed. Save applies everything it can at once and
 * says plainly what is left: only the vault folder waits for a restart.
 */
export function Settings({
  open,
  onClose,
  onEditKeys,
  onShowKeys,
  onEditSkill,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onEditKeys: () => void;
  onShowKeys: () => void;
  /** Open a skill's file in the editor. */
  onEditSkill: (path: string) => void;
  onSaved: (message: string) => void;
}) {
  const [saved, setSaved] = useState<SettingsData | null>(null);
  const [draft, setDraft] = useState<SettingsData | null>(null);
  const [names, setNames] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<RemoteCheck | "checking" | null>(null);
  const [skills, setSkills] = useState<SkillInfo[]>([]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setApiKey("");
    setClearKey(false);
    setCheck(null);
    backend
      .settings()
      .then((s) => {
        setSaved(s);
        setDraft(s);
        setNames(s.me.join(", "));
      })
      .catch((e) => setError(reason(e)));
    backend
      .skills()
      .then((r) => setSkills(r.skills))
      .catch(() => setSkills([]));
  }, [open]);

  if (!open) return null;

  const me = names.split(",").map((n) => n.trim()).filter(Boolean);
  const changes: SettingsChanges = {};
  if (saved && draft) {
    if (draft.vaultPath !== saved.vaultPath) changes.vaultPath = draft.vaultPath;
    if (draft.sync !== saved.sync) changes.sync = draft.sync;
    if (draft.syncRemote !== saved.syncRemote) changes.syncRemote = draft.syncRemote;
    if (draft.workspaceId !== saved.workspaceId) changes.workspaceId = draft.workspaceId;
    if (me.join("\n") !== saved.me.join("\n")) changes.me = me;
    if (clearKey) changes.clearApiKey = true;
    else if (apiKey.trim()) changes.apiKey = apiKey.trim();
  }
  const dirty = Object.keys(changes).length > 0;

  const save = async () => {
    if (!dirty || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await backend.saveSettings(changes);
      onSaved(
        next.restartNeeded
          ? "Saved. The new vault folder is used the next time Occam Notes opens."
          : "Settings saved and applied",
      );
      onClose();
    } catch (e) {
      setError(reason(e));
    } finally {
      setBusy(false);
    }
  };

  const runCheck = async () => {
    if (!draft?.syncRemote.trim()) return;
    setCheck("checking");
    try {
      setCheck(await backend.checkRemote(draft.syncRemote));
    } catch (e) {
      setCheck({ reachable: false, visibility: "unknown", detail: reason(e) });
    }
  };

  const set = (patch: Partial<SettingsData>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  return (
    <div className="settings-scrim" onMouseDown={onClose}>
      <div
        className="settings"
        role="dialog"
        aria-label="Settings"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
          // Keys typed into a field are not the app's shortcuts.
          e.stopPropagation();
        }}
      >
        <header className="settings-head">
          <h1>Settings</h1>
          <button className="settings-link" onClick={onClose} aria-label="Close">
            esc
          </button>
        </header>

        {!draft ? (
          <div className="settings-body">
            <p className="settings-hint">{error ?? "Loading…"}</p>
          </div>
        ) : (
          <div className="settings-body">
            <section>
              <h2>Backup</h2>
              <p className="settings-hint">
                Keeps the vault as a git repository: every pause in your editing becomes a
                commit, which is the history and the undo. With a remote, the same commits are
                pushed as an offsite copy.
              </p>
              <label className="settings-row">
                <span>History</span>
                <select
                  value={draft.sync}
                  onChange={(e) => set({ sync: e.target.value as SettingsData["sync"] })}
                >
                  <option value="git">On — commit as I work</option>
                  <option value="local">Off — files only, no history</option>
                </select>
              </label>
              <label className="settings-row">
                <span>Remote</span>
                <div className="settings-inline">
                  <input
                    type="text"
                    spellCheck={false}
                    disabled={draft.sync !== "git"}
                    placeholder="git@github.com:you/notes.git — leave empty for this machine only"
                    value={draft.syncRemote}
                    onChange={(e) => {
                      set({ syncRemote: e.target.value });
                      setCheck(null);
                    }}
                  />
                  <button
                    className="settings-button"
                    disabled={draft.sync !== "git" || !draft.syncRemote.trim() || check === "checking"}
                    onClick={() => void runCheck()}
                  >
                    {check === "checking" ? "Checking…" : "Check"}
                  </button>
                </div>
              </label>
              {check && check !== "checking" && <CheckResult check={check} />}
              {saved?.syncStatus && draft.sync === saved.sync && (
                // The same words as the dot in the sidebar, so the two never disagree.
                <p className="settings-hint">Now: {describeSync(saved.syncStatus).title}</p>
              )}
            </section>

            <section>
              <h2>AI</h2>
              <label className="settings-row">
                <span>API key</span>
                <div className="settings-inline">
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={clearKey}
                    placeholder={
                      draft.apiKeySet ? "A key is set — paste a new one to replace it" : "sk-ant-…"
                    }
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                  {draft.apiKeySet && !draft.apiKeyFromEnv && (
                    <button className="settings-button" onClick={() => setClearKey((v) => !v)}>
                      {clearKey ? "Keep it" : "Remove"}
                    </button>
                  )}
                </div>
              </label>
              <p className="settings-hint">
                {draft.apiKeyFromEnv
                  ? "ANTHROPIC_API_KEY is set in the environment, and is the key in use whatever is saved here."
                  : clearKey
                    ? "The key will be removed when you save."
                    : "Stored on this machine only. It is never shown again, here or anywhere else in the app."}
              </p>
              <label className="settings-row">
                <span>Workspace ID</span>
                <input
                  type="text"
                  spellCheck={false}
                  placeholder="Only for a personal (identity-linked) key — wrkspc_…"
                  value={draft.workspaceId}
                  onChange={(e) => set({ workspaceId: e.target.value })}
                />
              </label>
            </section>

            <section>
              <h2>You</h2>
              <label className="settings-row">
                <span>Your names</span>
                <input
                  type="text"
                  placeholder="Jim, Jim Howard"
                  value={names}
                  onChange={(e) => setNames(e.target.value)}
                />
              </label>
              <p className="settings-hint">
                Separated by commas. A meeting recap lists everyone's actions; this is how the
                ones you owe are told apart from the rest.
              </p>
            </section>

            <section>
              <h2>Vault</h2>
              <label className="settings-row">
                <span>Folder</span>
                <input
                  type="text"
                  spellCheck={false}
                  value={draft.vaultPath}
                  onChange={(e) => set({ vaultPath: e.target.value })}
                />
              </label>
              <p className="settings-hint">
                {draft.vaultPath !== saved?.vaultPath
                  ? "Used the next time Occam Notes opens — the one setting that waits for a restart. Your notes are not moved: this only changes where the app looks."
                  : "Where your notes live. Changing it needs a restart, and does not move any notes."}
              </p>
            </section>

            <section>
              <h2>AI skills</h2>
              <p className="settings-hint">
                A skill is one of the AI commands in the palette. Each is a prompt in a file:
                edit the file to change what the command does, delete it to remove the command,
                add a file to make a new one.
              </p>
              <div className="settings-list">
                {skills.map((sk) => (
                  <div key={sk.id} className="settings-list-row">
                    <span className="settings-list-name">{sk.title}</span>
                    <span className="settings-list-what">{whatItDoes(sk)}</span>
                    <button
                      className="settings-button"
                      onClick={() => (onClose(), onEditSkill(sk.path))}
                    >
                      Edit
                    </button>
                  </div>
                ))}
                {!skills.length && <p className="settings-hint">No skills found in the vault.</p>}
              </div>
            </section>

            <section>
              <h2>Keyboard</h2>
              <p className="settings-hint">
                Keys are a file in the vault, so they travel with your notes. A change applies as
                soon as the file is saved.
              </p>
              <div className="settings-links">
                <button className="settings-button" onClick={() => (onClose(), onEditKeys())}>
                  Change a key…
                </button>
                <button className="settings-button" onClick={() => (onClose(), onShowKeys())}>
                  See every shortcut
                </button>
              </div>
            </section>

            <p className="settings-hint settings-path">{draft.configPath}</p>
          </div>
        )}

        <footer className="settings-foot">
          <span className="settings-error">{error}</span>
          <button className="settings-button" onClick={onClose}>
            Cancel
          </button>
          <button className="settings-save" disabled={!dirty || busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save"}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** A skill's frontmatter, in words: what it reads and where the result goes. */
function whatItDoes(sk: SkillInfo): string {
  const reads: Record<string, string> = {
    selection: "the selected text",
    note: "this note",
    "note-and-links": "this note and the notes it links to",
    "week-done": "this week's finished tasks",
  };
  const writes: Record<string, string> = {
    replace: "replaces it",
    append: "adds the result to the end of the note",
    insert: "inserts the result at the cursor",
  };
  const ask = sk.asks ? "asks you a question, " : "";
  return `${ask}reads ${reads[sk.context] ?? sk.context}, ${writes[sk.mode] ?? sk.mode}`;
}

function CheckResult({ check }: { check: RemoteCheck }) {
  const bad = check.visibility === "public" || !check.reachable;
  const text =
    check.visibility === "public"
      ? check.detail
      : !check.reachable
        ? `Could not reach it${check.detail ? ` — ${check.detail}` : ""}`
        : check.visibility === "private"
          ? "Reachable, and private."
          : "Reachable. Could not tell whether it is private — make sure it is.";
  return (
    <p className="settings-hint" data-tone={bad ? "bad" : "good"}>
      {text}
    </p>
  );
}

/** The backend's message, out of `400: {"detail": "…"}`. */
function reason(e: unknown): string {
  const text = String(e instanceof Error ? e.message : e);
  try {
    return JSON.parse(text.replace(/^\d+:\s*/, "")).detail ?? text;
  } catch {
    return text;
  }
}
