import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Orchestrator, type JustEvent } from '../agents/orchestrator.js';
import { googleAccount, googleLogin } from '../auth/google.js';
import { PROVIDER_IDS, fmtRef, googleOAuth, providerSettings, saveConfig, type Config } from '../config.js';
import { COMMANDS, runCommand, type Tone } from '../core/commands.js';
import { complete, describeMentions, starterPrompts } from '../core/complete.js';
import { PromptHistory } from '../core/history.js';
import { openAppWindow } from '../core/open.js';
import { PRESETS, applySetup, needsSetup, presetById, testConnection } from '../core/setup.js';
import { listWorkspaceFiles, type PermissionRequest } from '../tools/index.js';

const STATIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../gui');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

type Item =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'info'; text: string; tone: Tone }
  | { kind: 'tool'; agent: string; name: string; summary: string }
  | { kind: 'agents'; agents: AgentView[] };

interface AgentView {
  id: string;
  name: string;
  model: string;
  task: string;
  status: 'queued' | 'running' | 'done' | 'error';
  activity: string;
  tools: number;
  start: number;
  end?: number;
}

export interface GuiOptions {
  cwd: string;
  config: Config;
  version: string;
  port?: number;
  open?: boolean;
}

/**
 * just-Code GUI: a local web app (127.0.0.1 only, random token) driving the same
 * orchestrator, commands, completion and setup as the terminal UI.
 */
export async function startGui(o: GuiOptions): Promise<{ url: string; close: () => void }> {
  let config = o.config;
  const token = crypto.randomBytes(18).toString('hex');
  const clients = new Set<http.ServerResponse>();
  const items: (Item & { id: number })[] = [];
  let seq = 0;
  let busy = false;
  let status = '';
  let agents: AgentView[] = [];
  let files: string[] = [];
  let loginAbort: AbortController | null = null;
  const history = new PromptHistory();
  const pending = new Map<string, { req: PermissionRequest; resolve: (ok: boolean) => void }>();
  const always = new Set<string>();
  let account = googleAccount();

  const refreshFiles = () => void listWorkspaceFiles(o.cwd).then((f) => (files = f));
  refreshFiles();

  const send = (type: string, data: unknown) => {
    const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of clients) c.write(msg);
  };
  const push = (it: Item) => {
    const full = { ...it, id: ++seq };
    items.push(full);
    if (items.length > 500) items.shift();
    send('item', full);
  };
  const say = (text: string, tone: Tone = 'info') => push({ kind: 'info', text, tone });

  const summary = () => ({
    orchestrator: fmtRef(config.orchestrator),
    subagent: fmtRef(config.subagent),
    maxParallel: config.maxParallel,
    turbo: config.turbo,
    keys: Object.fromEntries(PROVIDER_IDS.map((p) => [p, !!providerSettings(config, p).apiKey])),
    project: googleOAuth(config).quotaProject ?? null,
    account: account ?? null,
    needsSetup: needsSetup(config),
  });
  const setConfig = (c: Config) => {
    config = c;
    try {
      saveConfig(c);
    } catch {
      /* read-only home */
    }
    send('config', summary());
  };
  const setBusy = (b: boolean, s = '') => {
    busy = b;
    status = s;
    send('busy', { busy, status });
  };
  const setTurbo = (on: boolean) => {
    setConfig({ ...config, turbo: on });
    send('turbo', { on });
    if (on) {
      for (const [id, p] of pending) {
        p.resolve(true);
        send('permission:done', { id });
      }
      pending.clear();
    }
  };

  const requestPermission = (req: PermissionRequest) => {
    if (config.turbo || always.has(req.tool)) return Promise.resolve(true);
    const id = crypto.randomBytes(6).toString('hex');
    return new Promise<boolean>((resolve) => {
      pending.set(id, { req, resolve });
      send('permission', { id, req });
    });
  };

  const orch = new Orchestrator({ cwd: o.cwd, getConfig: () => config, requestPermission });
  const updateAgent = (id: string, f: (a: AgentView) => AgentView) => {
    agents = agents.map((a) => (a.id === id ? f(a) : a));
  };
  orch.on('event', (e: JustEvent) => {
    switch (e.type) {
      case 'orch:thinking':
        status = 'thinking…';
        break;
      case 'orch:text':
        push({ kind: 'assistant', text: e.text });
        break;
      case 'orch:tool':
        if (e.name === 'spawn_agents') status = `delegating to ${e.summary}…`;
        else push({ kind: 'tool', agent: 'orchestrator', name: e.name, summary: e.summary });
        break;
      case 'agent:spawn':
        agents.push({ id: e.id, name: e.name, model: e.model, task: e.task, status: 'queued', activity: e.task.split('\n')[0].slice(0, 120), tools: 0, start: Date.now() });
        break;
      case 'agent:start':
        updateAgent(e.id, (a) => ({ ...a, status: 'running', start: Date.now() }));
        break;
      case 'agent:tool':
        updateAgent(e.id, (a) => ({ ...a, tools: a.tools + 1, activity: `${e.name} ${e.summary}` }));
        break;
      case 'agent:done':
        updateAgent(e.id, (a) => ({ ...a, status: 'done', end: Date.now(), activity: e.result.replace(/\s+/g, ' ').slice(0, 160) }));
        status = 'reviewing reports…';
        break;
      case 'agent:error':
        updateAgent(e.id, (a) => ({ ...a, status: 'error', end: Date.now(), activity: e.error.slice(0, 160) }));
        break;
    }
    send('event', e);
    send('agents', { agents, status });
  });

  const command = (line: string) =>
    runCommand(line, {
      cwd: o.cwd,
      orch,
      getConfig: () => config,
      setConfig,
      say,
      setTurbo,
      setBusy,
      newAbort: () => {
        loginAbort = new AbortController();
        return loginAbort.signal;
      },
      onAccount: (e) => {
        account = e;
        send('config', summary());
      },
      openSetup: () => send('setup', {}),
    });

  const sendPrompt = async (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    history.add(text);
    if (text.startsWith('/')) return command(text);
    if (busy) return;
    push({ kind: 'user', text });
    agents = [];
    setBusy(true, 'thinking…');
    try {
      const answer = await orch.send(describeMentions(text, files));
      if (agents.length) push({ kind: 'agents', agents });
      if (answer.trim()) push({ kind: 'assistant', text: answer });
    } catch (e) {
      if (agents.length) push({ kind: 'agents', agents });
      say((e as Error).message, 'error');
    } finally {
      agents = [];
      send('agents', { agents, status: '' });
      setBusy(false);
      refreshFiles();
    }
  };

  /** Draft config from setup answers (not saved). */
  const draftFrom = (b: Record<string, unknown>) => {
    const preset = presetById(String(b.preset ?? ''));
    if (!preset) throw new Error('unknown provider');
    const s = (k: string) => (typeof b[k] === 'string' && (b[k] as string).trim() ? (b[k] as string).trim() : undefined);
    return applySetup(config, {
      preset,
      apiKey: s('apiKey'),
      baseUrl: s('baseUrl'),
      project: s('project'),
      orchestrator: s('orchestrator') ?? preset.orchestrator,
      sub: s('sub') ?? preset.sub,
      turbo: b.turbo === true,
    });
  };

  const readBody = (req: http.IncomingMessage) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      let b = '';
      req.on('data', (d) => {
        b += d;
        if (b.length > 1e6) req.destroy();
      });
      req.on('end', () => {
        try {
          resolve(b ? JSON.parse(b) : {});
        } catch (e) {
          reject(e);
        }
      });
    });

  const json = (res: http.ServerResponse, code: number, data: unknown) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  };

  let port = 0;
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1');
    // Only answer to our own origin (blocks DNS rebinding and other local sites).
    const host = req.headers.host ?? '';
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return json(res, 403, { error: 'bad host' });

    if (!u.pathname.startsWith('/api/')) {
      const rel = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
      const file = path.resolve(STATIC_DIR, rel);
      if (!file.startsWith(STATIC_DIR + path.sep) || !fs.existsSync(file)) return json(res, 404, { error: 'not found' });
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:",
        'X-Frame-Options': 'DENY',
      });
      return fs.createReadStream(file).pipe(res);
    }

    const t = req.headers['x-jc-token'] ?? u.searchParams.get('t');
    if (t !== token) return json(res, 401, { error: 'bad token' });
    if (req.method === 'POST' && req.headers['content-type'] !== 'application/json') return json(res, 415, { error: 'json only' });

    try {
      switch (`${req.method} ${u.pathname}`) {
        case 'GET /api/events': {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
          clients.add(res);
          res.write(
            `event: hello\ndata: ${JSON.stringify({
              version: o.version,
              cwd: o.cwd,
              config: summary(),
              items,
              busy,
              status,
              agents,
              pending: [...pending].map(([id, p]) => ({ id, req: p.req })),
              presets: PRESETS,
              commands: COMMANDS,
              starters: items.some((i) => i.kind === 'user') ? [] : starterPrompts(o.cwd),
            })}\n\n`,
          );
          const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
          req.on('close', () => {
            clearInterval(ping);
            clients.delete(res);
          });
          return;
        }
        case 'POST /api/send': {
          const b = await readBody(req);
          void sendPrompt(String(b.text ?? ''));
          return json(res, 202, { ok: true });
        }
        case 'POST /api/interrupt':
          orch.interrupt();
          loginAbort?.abort();
          say('⏹  interrupted', 'warn');
          return json(res, 200, { ok: true });
        case 'POST /api/permission': {
          const b = await readBody(req);
          const id = String(b.id);
          const p = pending.get(id);
          if (!p) return json(res, 404, { error: 'no such request' });
          const a = String(b.answer);
          if (a === 'turbo') {
            setTurbo(true);
            return json(res, 200, { ok: true });
          }
          pending.delete(id);
          send('permission:done', { id });
          p.resolve(a !== 'no');
          if (a === 'always') {
            always.add(p.req.tool);
            for (const [oid, op] of pending)
              if (op.req.tool === p.req.tool) {
                pending.delete(oid);
                send('permission:done', { id: oid });
                op.resolve(true);
              }
          }
          return json(res, 200, { ok: true });
        }
        case 'POST /api/turbo': {
          const b = await readBody(req);
          setTurbo(b.on === true);
          return json(res, 200, summary());
        }
        case 'GET /api/complete': {
          const q = u.searchParams.get('q') ?? '';
          return json(res, 200, complete(q, { cwd: o.cwd, config, files, history: history.items }));
        }
        case 'GET /api/history':
          return json(res, 200, history.items);
        case 'POST /api/test': {
          const draft = draftFrom(await readBody(req));
          return json(res, 200, await testConnection(draft, draft.orchestrator));
        }
        case 'POST /api/login': {
          const draft = draftFrom(await readBody(req));
          loginAbort = new AbortController();
          try {
            const email = await googleLogin(googleOAuth(draft), (url) => send('login-url', { url }), loginAbort.signal);
            account = email;
            return json(res, 200, { ok: true, email });
          } catch (e) {
            return json(res, 200, { ok: false, error: (e as Error).message });
          }
        }
        case 'POST /api/setup': {
          const draft = draftFrom(await readBody(req));
          setConfig(draft);
          say(`✔ All set!  orchestrator ${fmtRef(draft.orchestrator)} → sub-agents ${fmtRef(draft.subagent)}`, 'ok');
          if (draft.turbo) send('turbo', { on: true });
          return json(res, 200, summary());
        }
        case 'POST /api/skip-setup':
          setConfig({ ...config, setupDone: true });
          return json(res, 200, summary());
        default:
          return json(res, 404, { error: 'not found' });
      }
    } catch (e) {
      return json(res, 400, { error: (e as Error).message });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(o.port ?? 0, '127.0.0.1', () => resolve());
  });
  port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}/#${token}`;
  if (o.open !== false) await openAppWindow(url);
  return {
    url,
    close: () => {
      for (const c of clients) c.end();
      server.close();
    },
  };
}
