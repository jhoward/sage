"""Skills — prompts as vault content.

A skill is a markdown file in `<vault>/.sage/skills/`. That is the anti-bloat mechanism:
features are files, so a skill you do not use is a file you delete, and the app itself does
not grow. It is also why skills can be versioned, linked to from notes, shared as a folder,
and edited with the same editor as everything else.

    ---
    title: Clean up
    context: selection
    mode: replace
    ---
    Tidy the following text. Preserve meaning and voice...

Frontmatter keys (all optional except title):

    title    palette label
    context  selection | note | note-and-links | week-done   (what goes in the window)
    mode     replace | insert | append                       (what happens to the output)
    effort   low | medium | high | xhigh | max
    model    defaults to claude-opus-5
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

SKILLS_DIR = ".sage/skills"
DEFAULT_MODEL = "claude-opus-5"
FRONTMATTER_RE = re.compile(r"\A---\n(.*?)\n---\n?(.*)\Z", re.DOTALL)

VALID_CONTEXTS = {"selection", "note", "note-and-links", "week-done"}
VALID_MODES = {"replace", "insert", "append"}


@dataclass
class Skill:
    id: str
    title: str
    prompt: str
    context: str = "selection"
    mode: str = "replace"
    effort: str = "medium"
    model: str = DEFAULT_MODEL
    path: str = ""

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "context": self.context,
            "mode": self.mode,
            "path": self.path,
        }


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    """Split `---` frontmatter from the body.

    Deliberately a flat key: value parser rather than a YAML dependency — skills are
    prompts, and anything needing nested config is a sign the format is growing when it
    should not.
    """
    m = FRONTMATTER_RE.match(text)
    if not m:
        return {}, text.strip()

    meta: dict[str, str] = {}
    for raw in m.group(1).splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        key, _, value = line.partition(":")
        meta[key.strip().lower()] = value.strip().strip("\"'")

    return meta, m.group(2).strip()


def parse_skill(path: str, text: str) -> Skill | None:
    """Build a Skill from a file's contents. Returns None if there is no prompt body."""
    meta, body = parse_frontmatter(text)
    if not body:
        return None

    skill_id = Path(path).stem
    context = meta.get("context", "selection")
    mode = meta.get("mode", "replace")

    return Skill(
        id=skill_id,
        title=meta.get("title") or skill_id.replace("-", " ").capitalize(),
        prompt=body,
        # Fall back rather than reject: a typo in a skill file should not make the skill
        # vanish from the palette with no explanation.
        context=context if context in VALID_CONTEXTS else "selection",
        mode=mode if mode in VALID_MODES else "replace",
        effort=meta.get("effort", "medium"),
        model=meta.get("model", DEFAULT_MODEL),
        path=path,
    )


def load_skills(vault) -> list[Skill]:
    """Every skill in the vault, alphabetically by title."""
    folder = vault.root / SKILLS_DIR
    if not folder.is_dir():
        return []

    skills = []
    for file in sorted(folder.glob("*.md")):
        rel = f"{SKILLS_DIR}/{file.name}"
        try:
            skill = parse_skill(rel, vault.read_file(rel))
        except (OSError, UnicodeDecodeError):
            continue
        if skill:
            skills.append(skill)

    return sorted(skills, key=lambda s: s.title.lower())


# ---- the skills shipped on first run ---------------------------------
#
# Four, deliberately. They are a starting point to edit, not a library — the point of
# skills-as-files is that the set becomes yours.

DEFAULTS: dict[str, str] = {
    "cleanup.md": """---
title: Clean up
context: selection
mode: replace
effort: low
---
Tidy the text below: fix grammar, tighten wording, and make the structure clear.

Return the same content, only better written. Specifically:

- Do not add a heading, a title, or a summary line. If the text had no heading, the result
  has no heading.
- Do not add facts, framing, or transitions that were not there.
- Do not remove content. Every point in the input appears in the output.
- Keep the author's voice and level of formality. Rough notes stay rough notes; do not
  turn them into prose for an audience.
- Keep existing markdown, list structure, and [[wiki-links]] exactly as they are.

If the text is already clear, return it unchanged rather than finding something to alter.

Return only the cleaned text, with no preamble and no explanation.
""",
    "expand.md": """---
title: Expand
context: note
mode: replace
effort: medium
---
Expand the selected text into fuller prose, using the surrounding note for context.

Stay on the topic as written and keep the author's voice. Where you add detail, make it
concrete rather than padding. If something is genuinely uncertain, say so plainly rather
than inventing specifics.

Return only the expanded text, with no preamble.
""",
    "ask.md": """---
title: Ask, with this note as context
context: note-and-links
mode: append
effort: high
---
Answer the question using the note below, and the notes it links to, as context.

The value here is the context, not the question — this is what a generic chat window
cannot do. Ground the answer in what the notes actually say. Where the notes are silent
or contradictory, say so rather than filling the gap from general knowledge; where you do
draw on outside knowledge, mark it as such.

Be direct. No preamble.
""",
    "weekly-summary.md": """---
title: Weekly summary
context: week-done
mode: append
effort: medium
---
Write a short summary of the completed work below, suitable for pasting into a standup or
a status report.

Group related items rather than listing them one by one, and lead with what mattered most.
Write plain prose in the first person, a few sentences to a short paragraph. Do not pad,
do not add items that are not in the list, and do not editorialise about productivity.

Return only the summary.
""",
}


def ensure_default_skills(vault) -> list[str]:
    """Write the starter skills on first run. Never overwrites an edited file."""
    folder = vault.root / SKILLS_DIR
    folder.mkdir(parents=True, exist_ok=True)

    written = []
    for name, body in DEFAULTS.items():
        if not (folder / name).exists():
            vault.write_file(f"{SKILLS_DIR}/{name}", body)
            written.append(name)
    return written
