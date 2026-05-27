# CodeDelta

**Local-first commit-aware structural code intelligence.**

CodeDelta explains how code structure **changes across commits** and helps trace when bugs or behavior changes may have been introduced. It is built on top of [CodeGraph](#built-on-codegraph), which provides the structural analysis core.

## What CodeDelta does

CodeDelta focuses on **structural evolution**, not generic git browsing or line-level diffs.

### Delta View

Compare two commits and visualize structural impact:

- Changed symbols (functions, classes, components)
- Changed dependency edges (calls, imports)
- Affected modules and entry points
- Review suggestions ordered by risk

### Trace View

Describe a bug, behavior change, or architecture question. CodeDelta:

- Retrieves candidate commits from messages, files, and structural diffs
- Assembles evidence chains grounded in the graph
- Returns confidence, uncertainty, and what could not be confirmed

## What CodeDelta is not

- **Not a generic Git GUI** — no branch management, merge UI, or full history browser
- **Not a CodeWiki clone** — no auto-generated prose documentation site
- **Not just a text diff viewer** — the product is commit-aware **structural** intelligence

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

1. **Import** a public GitHub URL (`owner/repo` or full URL) or a **local git path**
2. Open **Commit Timeline** — browse commits on a branch
3. Select a commit — view changed files and quick actions
4. **Delta View** — compare commits (Phase 2: full structural diff)
5. **Trace View** — ask about an issue (Phase 3: evidence-grounded tracing)

API server runs at [http://localhost:3847](http://localhost:3847) (`GET /api/health`).

## Local-first and cache behavior

CodeDelta stores analysis locally under **`.codedelta/`** (gitignored):

| Path | Purpose |
|------|---------|
| `.codedelta/repos/<id>/` | Cloned or referenced git repositories |
| `.codedelta/registry.json` | Imported repository metadata |
| `.codedelta/snapshots/` | Cached CodeGraph snapshots per commit (Phase 2) |
| `.codedelta/settings.json` | Provider configuration |

**Lazy indexing:** commit lists load immediately. CodeGraph snapshots are built only when you open Delta View or Trace View for selected commits — not for full history by default.

## Provider options

Trace View uses a pluggable provider (Phase 3). Supported kinds:

| Provider | Description |
|----------|-------------|
| **No AI** | Timeline + Delta View with deterministic analysis only (default) |
| **Codex OAuth** | ChatGPT-style login when available |
| **OpenAI API key** | Direct OpenAI API |
| **OpenAI-compatible** | Custom endpoint (LocalAI, vLLM, etc.) |
| **Anthropic** | Claude API |
| **Ollama** | Local models |

Configure in **Provider Settings** in the web UI.

## Built on CodeGraph

This fork retains the CodeGraph core in [`src/`](src/):

- Tree-sitter extraction into a local SQLite knowledge graph
- Call graphs, impact radius, MCP tools for AI agents
- CLI: `codegraph init`, `codegraph sync`, `codegraph serve --mcp`

**CodeGraph** answers: *what is the code structure?*  
**CodeDelta** answers: *how did structure change across commits, and where might an issue have started?*

## Project structure

```
src/                          # CodeGraph core (unchanged)
packages/
  codedelta-types/            # Shared TypeScript models
  codedelta-repo-manager/     # Git import, commits, changed files
  codedelta-server/           # REST API
  codedelta-snapshot-manager/ # Phase 2
  codedelta-graph-diff/       # Phase 2
  codedelta-impact-score/     # Phase 2
  codedelta-trace-engine/     # Phase 3
  codedelta-provider-runtime/ # Phase 3
apps/
  web/                        # React + Vite UI
```

See [docs/codedelta/ROADMAP.md](docs/codedelta/ROADMAP.md) for the implementation roadmap.

## Development

```bash
# CodeGraph core
npm run build
npm test

# CodeDelta packages + web
npm run build:codedelta
npm run dev:codedelta
```

Environment variables:

- `CODEDELTA_CACHE_DIR` — override cache location (default: `.codedelta/` in cwd)
- `CODEDELTA_PORT` — API port (default: `3847`)

## License

MIT
