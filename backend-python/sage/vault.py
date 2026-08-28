"""Vault file operations.

The backend stays deliberately dumb: list, read, write, search. Wiki-link parsing,
markdown rendering, and the backlink index live in the shared frontend, which is what
keeps a future Rust port to roughly a day of work.

Two invariants matter here:
  - Writes are atomic (temp file in the same directory, then os.replace), so a sync
    daemon or a crash never observes a half-written note.
  - Every path from the outside world is resolved and confirmed to be inside the vault
    root before it is touched.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

MARKDOWN_SUFFIXES = {".md", ".markdown"}
SKIP_DIRS = {".git", ".obsidian", "node_modules", "__pycache__"}

# The one hidden directory the app will reveal on request.
SETTINGS_DIR = ".sage"

# Cap search output so a pathological query cannot flood the UI.
MAX_SEARCH_HITS = 200


class VaultError(Exception):
    """Raised for any invalid vault operation."""


@dataclass
class FileNode:
    name: str
    path: str  # vault-relative, POSIX separators
    is_dir: bool
    children: list["FileNode"] = field(default_factory=list)

    def to_dict(self) -> dict:
        out = {"name": self.name, "path": self.path, "isDir": self.is_dir}
        if self.is_dir:
            out["children"] = [c.to_dict() for c in self.children]
        return out


@dataclass
class SearchHit:
    path: str
    line: int
    text: str

    def to_dict(self) -> dict:
        return {"path": self.path, "line": self.line, "text": self.text}


class Vault:
    def __init__(self, root: Path):
        self.root = Path(root).expanduser().resolve()

    def ensure(self) -> None:
        """Create the vault and its seed files if they do not exist."""
        self.root.mkdir(parents=True, exist_ok=True)
        (self.root / "notes").mkdir(exist_ok=True)
        (self.root / "todo").mkdir(exist_ok=True)
        (self.root / ".sage" / "skills").mkdir(parents=True, exist_ok=True)

    # ---- path safety -------------------------------------------------

    def resolve(self, rel: str) -> Path:
        """Resolve a vault-relative path, refusing anything outside the root.

        Guards against traversal ("../etc/passwd"), absolute paths, and symlinks
        pointing out of the vault.
        """
        if not rel or rel in (".", "/"):
            raise VaultError("empty path")

        candidate = (self.root / rel).resolve()
        if candidate != self.root and self.root not in candidate.parents:
            raise VaultError(f"path escapes vault: {rel}")
        return candidate

    def _rel(self, path: Path) -> str:
        return path.relative_to(self.root).as_posix()

    # ---- operations --------------------------------------------------

    def list_files(self, include_hidden: bool = False) -> list[FileNode]:
        """Recursive markdown tree, directories first then files, both alphabetical.

        Dotfiles are hidden by default. `include_hidden` reveals `.sage/` — which is what
        "settings" means here: skills and config are ordinary files you edit in the editor,
        so there is no settings panel to build.
        """

        def walk(directory: Path) -> list[FileNode]:
            dirs: list[FileNode] = []
            files: list[FileNode] = []

            for entry in sorted(directory.iterdir(), key=lambda p: p.name.lower()):
                if entry.name in SKIP_DIRS:
                    continue
                hidden = entry.name.startswith(".")
                if hidden and not (include_hidden and entry.name == SETTINGS_DIR):
                    continue
                if entry.is_dir():
                    children = walk(entry)
                    if children:  # hide directories with no markdown in them
                        dirs.append(
                            FileNode(entry.name, self._rel(entry), True, children)
                        )
                elif entry.suffix.lower() in MARKDOWN_SUFFIXES or entry.suffix == ".toml":
                    files.append(FileNode(entry.name, self._rel(entry), False))

            return dirs + files

        if not self.root.exists():
            return []
        return walk(self.root)

    def read_file(self, rel: str) -> str:
        path = self.resolve(rel)
        if not path.is_file():
            raise VaultError(f"not a file: {rel}")
        return path.read_text(encoding="utf-8")

    def write_file(self, rel: str, content: str) -> None:
        """Write atomically: temp file in the same directory, then replace.

        Same-directory matters — os.replace is only atomic within one filesystem.
        """
        path = self.resolve(rel)
        path.parent.mkdir(parents=True, exist_ok=True)

        fd, tmp_name = tempfile.mkstemp(
            dir=path.parent, prefix=f".{path.name}.", suffix=".tmp"
        )
        tmp = Path(tmp_name)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(content)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, path)
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise

    def delete_file(self, rel: str) -> None:
        """Delete a note. The confirmation lives in the UI; this just does it."""
        path = self.resolve(rel)
        if not path.is_file():
            raise VaultError(f"not a file: {rel}")
        path.unlink()

    def search(self, query: str) -> list[SearchHit]:
        """Literal search. ripgrep when available, pure-Python otherwise.

        Rung 1 of the search ladder; see the plan for when to escalate to FTS5.
        """
        if not query.strip():
            return []
        if shutil.which("rg"):
            return self._search_ripgrep(query)
        return self._search_python(query)

    def _search_ripgrep(self, query: str) -> list[SearchHit]:
        proc = subprocess.run(
            [
                "rg", "--fixed-strings", "--ignore-case",
                "--line-number", "--no-heading", "--with-filename",
                "--max-count", "10", "--glob", "*.md", "--glob", "!.*/",
                "--", query, str(self.root),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        # rg exits 1 on "no matches", which is not an error condition.
        if proc.returncode not in (0, 1):
            return self._search_python(query)

        hits: list[SearchHit] = []
        for line in proc.stdout.splitlines()[:MAX_SEARCH_HITS]:
            parts = line.split(":", 2)
            if len(parts) != 3:
                continue
            filename, lineno, text = parts
            try:
                rel = Path(filename).resolve().relative_to(self.root).as_posix()
            except ValueError:
                continue
            hits.append(SearchHit(rel, int(lineno), text.strip()))
        return hits

    def _search_python(self, query: str) -> list[SearchHit]:
        needle = query.lower()
        hits: list[SearchHit] = []

        for path in sorted(self.root.rglob("*.md")):
            if any(part.startswith(".") or part in SKIP_DIRS for part in path.parts):
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            for lineno, line in enumerate(text.splitlines(), start=1):
                if needle in line.lower():
                    hits.append(SearchHit(self._rel(path), lineno, line.strip()))
                    if len(hits) >= MAX_SEARCH_HITS:
                        return hits
        return hits
