# CodeDelta

**Local-first commit-aware structural code intelligence.**

CodeDelta explains how code structure **changes across commits** and helps identify which commit may have introduced a behavior shift. It is built on top of [CodeGraph](#built-on-codegraph), which provides the structural analysis core.

## Current status

- Phase 1 foundation is complete (import, timeline, API, web shell).
- Phase 2 now provides a working **commit-to-commit Delta View**.
- Phase 2.5 refines Delta View for human review (summary, risk explanation, review order, clickable file diffs).
- Phase 3 now provides a **Trace View foundation** (evidence-first commit tracing with no-AI fallback).

## What CodeDelta does

CodeDelta focuses on **structural evolution**, not generic git browsing or line-level diffs.

### Delta View (implemented in Phase 2 + 2.5)

Compare two commits and inspect structural impact:

- Changed symbols (functions, classes, components, routes)
- Changed dependency edges (`calls`, `imports`)
- Affected nodes from graph traversal
- Deterministic impact score with severity/explanation
- Human-readable Delta Summary (main areas, risks, suggested review order)
- Clickable file-level diff modal for changed files and symbols
- Snapshot metadata (`codegraph` vs `fallback` extraction)

### Trace View (foundation implemented in Phase 3)

Describe a bug, behavior change, or architecture question. CodeDelta will:

- Retrieve candidate commits deterministically from commit history, messages, and file/symbol signals
- Reuse Delta compare evidence (`previous -> candidate`) when available
- Return direct answer, candidates, evidence, uncertainty, and suggested next checks
- Link each candidate commit back to Delta View for verification

## What CodeDelta is not

- **Not a generic Git GUI** — no merge UI or branch management workflow
- **Not a CodeWiki clone** — no auto-generated long-form repository docs
- **Not just a text diff viewer** — the product is commit-aware **structural** intelligence

## CodeDelta vs codebase-understanding tools

- Codebase-understanding tools explain what a repository looks like **now**.
- CodeDelta explains how a repository **changes over time**.
- CodeGraph is the structural analysis foundation.
- CodeDelta adds timeline, delta comparison, impact scoring, and future trace workflows.

## Quick start

Requires Node.js 20–24 and git.

```bash
git clone <this-repo>
cd CodeDelta
npm install
npm run build:codedelta
npm run dev:codedelta
```

Open [http://localhost:5173](http://localhost:5173).

1. Import a public GitHub URL (`owner/repo` or full URL) or local git path
2. Open Commit Timeline
3. Open Delta View and select `Base (before)` and `Head (after)` commits
4. Review changed files, structural summary, and impact score
5. Open Trace View to investigate likely introducing commits for an issue description

API server: [http://localhost:3847](http://localhost:3847)

- Health: `GET /api/health`
- Compare: `GET /api/repos/:repoId/compare?base=<hash>&head=<hash>`
- File diff: `GET /api/repos/:repoId/diff?base=<hash>&head=<hash>&file=<path>`
- Trace: `POST /api/repos/:repoId/trace`

## Supported delta source in current implementation

Current implementation supports only:

- `commit -> commit`

Future variants (not implemented yet):

- `branch -> branch`
- `tag -> tag`
- `PR base -> PR head`
- `working tree -> HEAD`
- `local folder -> local folder`

## Local-first and cache behavior

CodeDelta stores analysis locally under **`.codedelta/`** (gitignored):

| Path | Purpose |
|------|---------|
| `.codedelta/repos/<id>/` | Cloned or referenced repositories |
| `.codedelta/registry.json` | Imported repository registry |
| `.codedelta/snapshots/<repoId>/<hash>/<analyzerVersion>/snapshot.json` | Commit snapshots |
| `.codedelta/settings.json` | Provider configuration |

Snapshots are built lazily when compare is requested; full history pre-indexing is intentionally avoided.

## Extraction behavior in Phase 2

Primary path:

- Build snapshot with CodeGraph (`index + exportGraph`) in an isolated worktree.

Fallback path:

- Minimal TS/JS extractor when CodeGraph snapshot build fails.
- Captures files, imports, exported symbols, simple React components, and route-like files.
- Snapshot metadata includes `extractionMethod: "fallback"` and warning text.

## Provider options for Trace View

- No AI
- OpenAI-compatible endpoint (minimal support in Phase 3)
- OpenAI API key (same chat-completions interface)
- Codex OAuth (reuse local `codex login` / `~/.codex/auth.json`)
- Anthropic (not implemented, planned)
- Ollama (not implemented, planned)

## Built on CodeGraph

This fork retains the CodeGraph core in [`src/`](src/):

- Tree-sitter extraction into local SQLite graph
- Call graphs and impact radius traversal
- MCP tooling and CLI (`codegraph init`, `codegraph sync`, `codegraph serve --mcp`)

**CodeGraph** answers: *what is the code structure?*  
**CodeDelta** answers: *how does structure change between commits and where risk accumulates?*

## Project structure

```
src/                          # CodeGraph core (kept reusable)
packages/
  codedelta-types/            # Shared models
  codedelta-repo-manager/     # Repo import + commit APIs
  codedelta-server/           # REST orchestration
  codedelta-snapshot-manager/ # Worktree snapshot builder
  codedelta-graph-diff/       # Structural diff engine
  codedelta-impact-score/     # Deterministic scoring + explanation
  codedelta-delta-summary/    # Deterministic human-readable summary
  codedelta-trace-engine/     # Deterministic trace candidate retrieval
  codedelta-provider-runtime/ # Provider abstraction + no-AI fallback
apps/
  web/                        # React + Vite frontend
```

See [docs/codedelta/ROADMAP.md](docs/codedelta/ROADMAP.md) for roadmap details.

## Current limitations

- TypeScript/JavaScript-first practical path
- Commit-to-commit delta only
- Lazy snapshot indexing (no full history index)
- Trace remains commit-history scoped only (no branch/PR/working-tree trace source yet)
- Codex OAuth uses local CLI session only (no in-app browser login)
- Rich graph visualization not implemented yet (table/list view now)
- Symbol-to-hunk mapping not implemented yet (symbol click opens file-level diff)
- LLM-assisted summary not implemented yet
- Provider output is optional and non-authoritative; deterministic evidence is source of truth

## Development

```bash
# CodeGraph core
npm run build

# CodeDelta packages + web
npm run build:codedelta
npm run dev:codedelta

# Phase 2/2.5 focused tests
npm test -- packages/codedelta-graph-diff packages/codedelta-impact-score packages/codedelta-server packages/codedelta-snapshot-manager
```

Environment variables:

- `CODEDELTA_CACHE_DIR` — override cache root (default: `.codedelta/`)
- `CODEDELTA_PORT` — API port (default: `3847`)
- `CODEDELTA_SNAPSHOT_TIMEOUT_MS` — snapshot timeout (default: `120000`)
- `CODEDELTA_SNAPSHOT_MAX_NODES` — snapshot node cap (default: `50000`)

## License

MIT
