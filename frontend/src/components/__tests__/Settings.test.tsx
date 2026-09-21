import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Settings as SettingsData } from "../../backend";

const api = vi.hoisted(() => ({
  settings: vi.fn(),
  saveSettings: vi.fn(),
  checkRemote: vi.fn(),
  skills: vi.fn(),
}));
vi.mock("../../backend", () => ({ backend: api }));

import { Settings } from "../Settings";

const CURRENT: SettingsData = {
  configPath: "/Users/me/.config/occam/config.toml",
  vaultPath: "/Users/me/occam",
  sync: "git",
  syncRemote: "git@github.com:me/notes.git",
  apiKeySet: true,
  apiKeyFromEnv: false,
  workspaceId: "",
  me: ["Jim"],
  syncStatus: { backend: "git", state: "ok", detail: "", conflicts: [] },
};

const handlers = () => ({
  onClose: vi.fn(),
  onEditKeys: vi.fn(),
  onShowKeys: vi.fn(),
  onEditSkill: vi.fn(),
  onSaved: vi.fn(),
});

async function open(h = handlers()) {
  render(<Settings open {...h} />);
  await screen.findByDisplayValue("/Users/me/occam");
  return h;
}

beforeEach(() => {
  api.settings.mockResolvedValue(CURRENT);
  api.saveSettings.mockResolvedValue({ ...CURRENT, restartNeeded: false });
  api.skills.mockResolvedValue({
    available: true,
    skills: [
      { id: "cleanup", title: "Clean up", context: "selection", mode: "replace", path: ".occam/skills/cleanup.md" },
      { id: "ask", title: "Ask about this note", context: "note-and-links", mode: "append", asks: true, path: ".occam/skills/ask.md" },
    ],
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the settings screen", () => {
  it("has every kind of setting on the one screen", async () => {
    await open();
    for (const section of ["Backup", "AI", "You", "Vault", "AI skills", "Keyboard"]) {
      expect(screen.getByRole("heading", { name: section })).toBeTruthy();
    }
  });

  it("closes on Escape even when nothing inside it has focus", async () => {
    const h = await open();
    // As it is in the app: the key arrives at the window, not at the dialog.
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it("takes focus when it opens, so typing does not land in the note behind it", async () => {
    await open();
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("does not take focus back from a field when the parent re-renders", async () => {
    const h = handlers();
    const { rerender } = render(<Settings open {...h} />);
    const field = (await screen.findByDisplayValue("Jim")) as HTMLInputElement;
    field.focus();

    // What the sync poll does every fifteen seconds: a render with new callbacks.
    rerender(<Settings open {...handlers()} />);
    expect(document.activeElement).toBe(field);
  });

  it("says a key is set without having one to show", async () => {
    await open();
    const field = screen.getByPlaceholderText(/A key is set/) as HTMLInputElement;
    expect(field.value).toBe("");
    expect(field.type).toBe("password");
  });

  it("cannot save until something changes, then sends only what changed", async () => {
    const h = await open();
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByDisplayValue("Jim"), { target: { value: "Jim, Jim Howard" } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    await waitFor(() => expect(h.onClose).toHaveBeenCalled());
    // No apiKey, no vaultPath: an untouched field is not a change.
    expect(api.saveSettings).toHaveBeenCalledWith({ me: ["Jim", "Jim Howard"] });
    expect(h.onSaved).toHaveBeenCalledWith("Settings saved and applied");
  });

  it("sends a new key only when one was typed", async () => {
    await open();
    fireEvent.change(screen.getByPlaceholderText(/A key is set/), { target: { value: " sk-new " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ apiKey: "sk-new" }));
  });

  it("removing the key is explicit, and can be taken back", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByText(/will be removed when you save/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("says that a new vault folder waits for a restart, before and after saving", async () => {
    api.saveSettings.mockResolvedValue({ ...CURRENT, restartNeeded: true });
    const h = await open();
    fireEvent.change(screen.getByDisplayValue("/Users/me/occam"), { target: { value: "/Users/me/other" } });
    expect(screen.getByText(/the one setting that waits for a restart/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.onSaved).toHaveBeenCalled());
    expect(h.onSaved.mock.calls[0][0]).toMatch(/next time Occam Notes opens/);
  });

  it("shows why a save was refused, and stays open", async () => {
    api.saveSettings.mockRejectedValue(new Error('400: {"detail":"That does not look like a git remote."}'));
    const h = await open();
    fireEvent.change(screen.getByDisplayValue("git@github.com:me/notes.git"), { target: { value: "--nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("That does not look like a git remote.")).toBeTruthy();
    expect(h.onClose).not.toHaveBeenCalled();
  });

  it("warns loudly about a public remote", async () => {
    api.checkRemote.mockResolvedValue({
      reachable: true,
      visibility: "public",
      detail: "This repository is PUBLIC. Anyone can read what is pushed to it.",
    });
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    const warning = await screen.findByText(/This repository is PUBLIC/);
    expect(warning.getAttribute("data-tone")).toBe("bad");
  });

  it("confirms a private, reachable remote", async () => {
    api.checkRemote.mockResolvedValue({ reachable: true, visibility: "private", detail: "" });
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect((await screen.findByText("Reachable, and private.")).getAttribute("data-tone")).toBe("good");
  });

  it("lists each skill by name, says what it does, and opens its file", async () => {
    const h = await open();
    expect(await screen.findByText("Clean up")).toBeTruthy();
    expect(screen.getByText("reads the selected text, replaces it")).toBeTruthy();
    expect(
      screen.getByText(
        "asks you a question, reads this note and the notes it links to, adds the result to the end of the note",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    expect(h.onEditSkill).toHaveBeenCalledWith(".occam/skills/cleanup.md");
    expect(h.onClose).toHaveBeenCalled();
  });

  it("explains an environment key instead of offering to remove it", async () => {
    api.settings.mockResolvedValue({ ...CURRENT, apiKeyFromEnv: true });
    await open();
    expect(screen.getByText(/ANTHROPIC_API_KEY is set in the environment/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });
});
