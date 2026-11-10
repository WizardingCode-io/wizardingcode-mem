# Brief

## Request

Knowledge store: entries as Markdown with frontmatter (kind knowledge, strategy, persona or pattern; area, context, subject; title, status, author, version), one git repository per scope (workspace, project, shared) under the data directory, the index as the knowledge module's own tables rebuilt from the files, the taxonomy (nine starting areas, editable) as a file in the workspace repository, every write a commit with its author (person or agent), an agent's write a proposal until a person accepts it; ADR 0024 draft.

## Goal

The engine gains a second module, knowledge, with its storage: entries a person or an agent writes, kept as Markdown files with frontmatter in a git repository per scope, indexed in the engine's database, every change committed with its author, and an agent's change held as a proposal until a person accepts it. This part is the store alone: what later parts (the MCP tools and the composer, the viewer, the sharing policy, the team server) read and write.

## Context

Today the engine holds one module, memory (ADR 0019): what happened in each project's sessions, observed and local. A knowledge module was built and withdrawn before 0.6.0 (ADR 0020, branch `archive/knowledge-module`) on the 2026-10-13 decision that knowledge and personas were a separate product. On 2026-11-08 the user reversed that decision (journey 2026-11-08-001, questions Q-1 to Q-4 of item 2026-11-08-003 in the main checkout): knowledge and personas are part of this engine. The team's curated knowledge lives in Obsidian, where agents cannot reach it; the knowledge base starts from zero with a new pattern (Q-4), nothing is imported.

## Constraints

- Memory stays always on and the hook path stays light (ADR 0019, ADR 0022): nothing in this part runs on a hook. The store is read and written by commands, tools and the viewer; the hooks of later parts read only the index.
- Clean room: nothing from claude-mem (`CLEAN-ROOM.md`). The archived branch may be read for ideas; every file is written fresh against the current engine.
- Every change to knowledge is versioned, so that agents cannot disorganise it (Q-3): a write is a commit in the scope's repository, with its author.
- An agent's change is a proposal until a person accepts it; a person's change is applied at once.
- Product text in English. The binary keeps the name `wizardingcode-mem`.
- Semantic judgements (cataloguing, duplicates, contradictions) are the next part's, through the `Judge` interface; this part stores what the frontmatter says and validates it exactly.
- With no knowledge entries, memory's brief and prompt notes stay byte for byte as before (pinned snapshots); this part adds no contribution to the composer.

## Acceptance

- An entry is one Markdown file with frontmatter: `title`, `kind` (knowledge, strategy, persona, pattern), `area`, `context`, `subject`, `status` (active, draft, archived), `author` (a person's name or `agent:<id>`), `version` (a whole number from 1), `created`, `updated`; the body is Markdown. A file the parser cannot read whole is listed with its problem and never counted active.
- Each scope has one git repository under the data directory: `knowledge/workspace`, `knowledge/projects/<project key>`, `knowledge/shared`; created on first write, never inside a project's own folder.
- The index is the knowledge module's own tables, applied by the module migration namespace (ADR 0019 F2) after the core migrations, and rebuilt from the files by `wizardingcode-mem knowledge rebuild`; deleting the tables loses nothing.
- The taxonomy is a file in the workspace repository with the nine starting areas (code, management, marketing, sales, video, design, operations, finance, people); an area can be added, renamed or removed, and an entry's area must be one of the taxonomy's.
- Every write is one commit in the scope's repository, authored by the person or the agent named, with the entry's version raised by one; a write whose base version is not the current one is refused, never applied over the other.
- A write by an agent becomes a proposal (a pending change recorded with its author and the full proposed entry), not a change to the entry; a person accepts it (applied as a commit naming both) or rejects it; both decisions are recorded.
- `docs/adr/0024-knowledge-module.md` records the decisions of this part as a draft the later parts complete.

## Assumptions

- The git binary is present on the machine (the agents this product serves are coding agents); its absence is reported by `doctor` and refuses writes with a clear message.
- A project's key for its repository folder is a filesystem-safe hash of the project's strongest alias (`src/core/project.ts`), stable across clones of the same remote.
- The person's author name comes from the settings (`WIZARDINGCODE_KNOWLEDGE_AUTHOR`), the git identity as the fallback, and `you` when neither exists.
