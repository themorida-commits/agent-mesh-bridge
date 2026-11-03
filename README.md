# agent-mesh-bridge

A zero-dependency **stdio MCP server** that lets AI coding agents delegate tasks to each other across the desktop tools they already run in — **ZCode, Codeg, Ghostex, Claude Code and Codex** — in both directions.

One file, no npm dependencies: `agent-mesh-mcp.js`. It speaks newline-delimited JSON-RPC (MCP) on stdio and shells out to the first-party CLIs of each app:

- **Codeg** → `codeg-cli` (bundled in Codeg.app)
- **Ghostex** → the `ghostex` CLI / gxserver
- **ZCode** → ZCode's own CLI runtime (`zcode -p --surface desktop`), sharing the desktop app's login and config

Register the same server in every MCP client you use, and any agent in any of those apps can hand work to an agent in another — e.g. a task given inside ZCode can be implemented by Codex running in Codeg, or dispatched into a live Ghostex terminal session.

## Tools (10)

| Tool | What it does |
|---|---|
| `codeg_status` | Show which Codeg runtimes are reachable. |
| `codeg_agents` | List the agents Codeg knows (claude_code, codex, zcode, open_code, …) and whether each is enabled/installed. |
| `codeg_run` | Delegate a task to an agent inside Codeg and wait for its final reply. |
| `ghostex_sessions` | List running Ghostex terminal/agent sessions (JSON). |
| `ghostex_agents` | List Ghostex agent types available for dispatch. |
| `ghostex_dispatch` | Open a **new** agent session inside Ghostex for a project and send it a task. Waits for the agent TUI to be ready and dismisses first-run review gates (e.g. the Codex hooks review) with Escape — it closes the gate **without trusting** anything. |
| `ghostex_send` | Type text (and submit) into an existing Ghostex session. |
| `zcode_run` | Run one prompt through ZCode's CLI runtime and wait for the reply. |
| `muse_delegate` | Queue a task for the *host agent* (see below) asynchronously; returns a task id. |
| `muse_result` | Poll the result of a `muse_delegate` task by id. |

### The host-agent inbox (`muse_delegate` / `muse_result`)

`muse_delegate` writes a JSON task file into `~/agent-bridges/inbox/` and returns an id. Whatever supervising agent you run on the host (the reference setup uses a personal agent called Muse) picks tasks up from the inbox, does the work, and writes the outcome to `~/agent-bridges/outbox/<id>.json`, which `muse_result` reads back. There is deliberately **no daemon and no polling loop** in this repo — pickup policy is the host agent's own business.

## Requirements

- macOS (the CLI paths and app bundles are macOS-specific)
- Node.js (any recent LTS; the server uses only the standard library)
- Whichever of these you want to reach, installed and signed in:
  - [Codeg](https://codeg.app) desktop app — provides `codeg-cli`
  - Ghostex desktop app — provides the `ghostex` CLI and gxserver
  - ZCode desktop app — provides the `zcode` CLI runtime
- You only need the apps you actually delegate to; the other tools simply return an error if their CLI is missing.

## Install

1. Clone this repo somewhere stable, e.g. `~/agent-bridges/`:

   ```bash
   git clone <this-repo-url> ~/agent-bridges
   mkdir -p ~/agent-bridges/inbox ~/agent-bridges/outbox
   ```

2. Register the server in each MCP client you use. Ready-made snippets with placeholder paths live in [`examples/`](examples/):

   | Client | Config file | Example |
   |---|---|---|
   | Claude Code | `~/.claude.json` (`mcpServers`) | `examples/claude-code.json` |
   | Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` | `examples/claude-desktop.json` |
   | Codex | `~/.codex/config.toml` (`[mcp_servers.agent-mesh]`) | `examples/codex-config.toml` |
   | OpenCode | `~/.config/opencode/opencode.json` | `examples/opencode.json` |
   | ZCode | `~/.zcode/cli/config.json` | `examples/zcode.json` |
   | Ghostex | No registration needed — Ghostex sessions read the agents' own native configs above | — |
   | Codeg | No registration needed — Codeg aggregates the agents' native configs | — |

3. Restart the clients so they pick up the new server, then ask any agent to call `codeg_status` as a smoke test.

## Configuration (environment variables)

All optional — defaults match a standard single-user macOS install.

| Variable | Default | Purpose |
|---|---|---|
| `AGENT_MESH_CODEG_CLI` | `/Applications/Codeg.app/Contents/MacOS/codeg-cli` | Path to `codeg-cli` |
| `AGENT_MESH_GHOSTEX_BIN` | `/opt/homebrew/bin/ghostex` | Path to the `ghostex` CLI |
| `AGENT_MESH_ZCODE_BIN` | `~/.local/bin/zcode` | Path to the `zcode` CLI |
| `AGENT_MESH_BRIDGE_DIR` | `~/agent-bridges` | Base dir for the inbox/outbox |
| `AGENT_MESH_INBOX` | `$AGENT_MESH_BRIDGE_DIR/inbox` | `muse_delegate` task queue |
| `AGENT_MESH_OUTBOX` | `$AGENT_MESH_BRIDGE_DIR/outbox` | `muse_result` results |

Timeouts: delegated runs (`codeg_run`, `zcode_run`) wait up to 25 minutes; simple queries time out after 60 s. Tool output is truncated to the last 6,000 characters.

## Security notes

- This server runs the CLIs **with your user privileges** and passes prompts through to agents that can edit code and run commands. Only register it in MCP clients you trust, and treat any client that can call these tools as able to delegate arbitrary work on your machine.
- The inbox is a plain folder of JSON files. Anything that can write to `~/agent-bridges/inbox/` can queue tasks for your host agent — the host agent should treat task files as untrusted input.
- No credentials are stored in this repo or needed by the server: each delegated CLI uses its own app's existing login.

## Limitations (honest list)

- **Gemini Desktop cannot be delegated to.** The official Gemini desktop app exposes no MCP server, no API and no AppleScript surface — only a URL scheme that opens the app — and it has no repo/task execution tools. There is no bridge to build; only fragile GUI automation would remain, and it is intentionally not included.
- **Codeg's own in-session delegation stays off.** This mesh does not use or require Codeg's built-in `delegate_to_agent`; delegation here happens explicitly, one tool call at a time, through the CLIs.
- Ghostex also ships a native ZCode agent type, so Ghostex → ZCode works without this bridge; the bridge's value there is the unified surface from the *other* clients.
- `ghostex_dispatch` identifies the new session by diffing the session list before/after creation; heavy parallel dispatch from several clients at once can confuse that matching.
- macOS only, and tied to the current CLI surfaces of Codeg/Ghostex/ZCode — if a vendor changes its CLI, the corresponding tools break, not the whole server.

## Provenance

Extracted from a working personal setup where this bridge was verified live on 2026-10-31: MCP handshake + `codeg_status`, and an end-to-end Ghostex dispatch in which a freshly created Codex session received a prompt through the bridge and replied. Paths and one project-specific example string were sanitized for publication; behaviour is otherwise unchanged.

## License

MIT — see [LICENSE](LICENSE). © 2026 Saeed Morida.
