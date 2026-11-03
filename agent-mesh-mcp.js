// agent-mesh-mcp.js — bidirectional task bridge between ZCode / Codeg / Ghostex / Muse.
// Zero-dependency stdio MCP server (NDJSON JSON-RPC). Tools shell out to first-party CLIs:
//   codeg-cli (Codeg desktop), ghostex CLI (gxserver), zcode CLI (ZCode's own runtime).
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = process.env.HOME || os.homedir();
// Binary locations and bridge directories can be overridden via the environment;
// the defaults below match a standard macOS install for a single user.
const CODEG_CLI = process.env.AGENT_MESH_CODEG_CLI || '/Applications/Codeg.app/Contents/MacOS/codeg-cli';
const GX = process.env.AGENT_MESH_GHOSTEX_BIN || '/opt/homebrew/bin/ghostex';
const ZCODE = process.env.AGENT_MESH_ZCODE_BIN || path.join(HOME, '.local/bin/zcode');
const BRIDGE_DIR = process.env.AGENT_MESH_BRIDGE_DIR || path.join(HOME, 'agent-bridges');
const INBOX = process.env.AGENT_MESH_INBOX || path.join(BRIDGE_DIR, 'inbox');
const OUTBOX = process.env.AGENT_MESH_OUTBOX || path.join(BRIDGE_DIR, 'outbox');

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, {
      timeout: opts.timeout || 60000,
      maxBuffer: 16 * 1024 * 1024,
      cwd: opts.cwd || HOME,
      env: { ...process.env, PATH: '/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:' + HOME + '/.local/bin' },
    }, (err, stdout, stderr) => {
      let out = (stdout || '').trim();
      const errText = (stderr || '').trim();
      if (err) {
        resolve({ ok: false, text: `ERROR (${err.code || 'exit'}): ${errText || err.message}\n${out}`.slice(-6000) });
      } else {
        resolve({ ok: true, text: (out || errText || '(no output)').slice(-6000) });
      }
    });
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TOOLS = [
  { name: 'codeg_status', description: 'Show which Codeg runtimes are reachable.', inputSchema: { type: 'object', properties: {} } },
  { name: 'codeg_agents', description: 'List the agents Codeg knows, and whether each is enabled and installed (claude_code, codex, zcode, open_code, ...).', inputSchema: { type: 'object', properties: {} } },
  { name: 'codeg_run', description: 'Delegate a task to an agent inside Codeg and wait for its final reply. Use for real implementation work in a repo.', inputSchema: { type: 'object', properties: { agent: { type: 'string', description: 'Codeg agent slug, e.g. claude_code, codex, zcode, open_code' }, prompt: { type: 'string' }, workspace: { type: 'string', description: 'Absolute path of the working directory' } }, required: ['agent', 'prompt', 'workspace'] } },
  { name: 'ghostex_sessions', description: 'List running Ghostex terminal/agent sessions as JSON.', inputSchema: { type: 'object', properties: {} } },
  { name: 'ghostex_agents', description: 'List Ghostex agent types (codex, claude, zcode, opencode, ...) available for dispatch.', inputSchema: { type: 'object', properties: {} } },
  { name: 'ghostex_dispatch', description: 'Open a NEW agent session inside Ghostex for a project and send it a task prompt. Returns the session ref. The agent works in its live Ghostex terminal session.', inputSchema: { type: 'object', properties: { agent: { type: 'string', description: 'Ghostex agent id, e.g. codex, claude, zcode, opencode' }, project_id: { type: 'string', description: 'Ghostex project id, e.g. P1234' }, prompt: { type: 'string' } }, required: ['agent', 'project_id', 'prompt'] } },
  { name: 'ghostex_send', description: 'Type text (and submit) into an existing Ghostex session by id or quoted title.', inputSchema: { type: 'object', properties: { selector: { type: 'string' }, text: { type: 'string' } }, required: ['selector', 'text'] } },
  { name: 'zcode_run', description: 'Run one prompt through ZCode (its own CLI runtime, sharing the desktop app login and config) and wait for the reply.', inputSchema: { type: 'object', properties: { prompt: { type: 'string' }, workspace: { type: 'string', description: 'Absolute path of the working directory' } }, required: ['prompt'] } },
  { name: 'muse_delegate', description: 'Hand a task to Muse (the user\'s personal agent) asynchronously. Returns a task id; poll muse_result for the outcome. Muse picks tasks up when active and works with full access to the user\'s projects and accounts.', inputSchema: { type: 'object', properties: { task: { type: 'string' } }, required: ['task'] } },
  { name: 'muse_result', description: 'Check the result of a muse_delegate task by id.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
];

async function callTool(name, a) {
  switch (name) {
    case 'codeg_status': return run(CODEG_CLI, ['status']);
    case 'codeg_agents': return run(CODEG_CLI, ['agents']);
    case 'codeg_run': return run(CODEG_CLI, ['run', '-a', a.agent, '-w', a.workspace, '-p', a.prompt], { timeout: 1500000 });
    case 'ghostex_sessions': return run(GX, ['sessions', '--json']);
    case 'ghostex_agents': return run(GX, ['agents', 'types']);
    case 'ghostex_send': {
      return run(GX, ['send-message', a.selector, a.text]);
    }
    case 'ghostex_dispatch': {
      const before = await run(GX, ['sessions', '--json']);
      const beforeRefs = new Set();
      try { for (const s of JSON.parse(before.text).sessions || []) beforeRefs.add(s.globalRef); } catch (e) {}
      const created = await run(GX, ['create-agent', a.agent, '--project-id', a.project_id], { timeout: 120000 });
      if (!created.ok) return created;
      await sleep(6000);
      const after = await run(GX, ['sessions', '--json']);
      let target = null;
      try {
        const list = (JSON.parse(after.text).sessions || []).filter((s) => !beforeRefs.has(s.globalRef));
        target = list[list.length - 1] || null;
      } catch (e) {}
      if (!target) return { ok: false, text: 'Agent session created but could not identify the new session ref.\n' + created.text };
      const sel = target.globalRef;
      // Wait for the agent TUI to be ready; dismiss first-run review gates WITHOUT trusting
      // (e.g. Codex hooks review: Escape closes it, unreviewed hooks stay off).
      for (let i = 0; i < 10; i++) {
        const scr = await run(GX, ['read-text', sel, '--visible']);
        if (scr.ok && scr.text.includes('need review before they can run')) {
          await run(GX, ['send-key', sel, 'escape']);
          await sleep(3000);
          continue;
        }
        if (scr.ok && (scr.text.includes('Ask Codex to do anything') || scr.text.includes('bypass permissions') || i >= 5)) break;
        await sleep(5000);
      }
      const s1 = await run(GX, ['send-message', sel, a.prompt]);
      return { ok: s1.ok, text: `Dispatched to Ghostex session ${sel} (agent=${a.agent}, project=${a.project_id}).\n${s1.text}`.slice(-4000) };
    }
    case 'zcode_run': return run(ZCODE, ['-p', a.prompt, '--surface', 'desktop'], { timeout: 1500000, cwd: a.workspace || HOME });
    case 'muse_delegate': {
      const id = 'mt-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
      fs.mkdirSync(INBOX, { recursive: true });
      fs.writeFileSync(path.join(INBOX, id + '.json'), JSON.stringify({ id, task: a.task, created_at: new Date().toISOString(), from: 'agent-mesh' }, null, 2));
      return { ok: true, text: `Task queued for Muse with id ${id}. Poll muse_result with this id.` };
    }
    case 'muse_result': {
      const p = path.join(OUTBOX, a.id + '.json');
      if (fs.existsSync(p)) return { ok: true, text: fs.readFileSync(p, 'utf8').slice(-6000) };
      const q = path.join(INBOX, a.id + '.json');
      return { ok: true, text: fs.existsSync(q) ? 'pending: Muse has not completed this task yet.' : 'unknown id: no such task.' };
    }
    default: return { ok: false, text: 'unknown tool: ' + name };
  }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', async (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch (e) { continue; }
    const reply = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
    if (msg.method === 'initialize') {
      reply({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: (msg.params && msg.params.protocolVersion) || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'agent-mesh', version: '1.0.0' } } });
    } else if (msg.method === 'tools/list') {
      reply({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } });
    } else if (msg.method === 'tools/call') {
      const t = await callTool(msg.params.name, msg.params.arguments || {});
      reply({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: t.text }], isError: !t.ok } });
    } else if (msg.method === 'ping') {
      reply({ jsonrpc: '2.0', id: msg.id, result: {} });
    } else if (msg.id !== undefined && msg.method) {
      reply({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found: ' + msg.method } });
    }
  }
});
