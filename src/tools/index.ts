import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { ToolDef } from '../providers/types.js';

export interface ToolContext {
  cwd: string;
  agent: string;
  signal?: AbortSignal;
  /** Resolves true if the action is allowed (turbo mode auto-approves). */
  requestPermission: (req: PermissionRequest) => Promise<boolean>;
}

export interface PermissionRequest {
  agent: string;
  tool: string;
  summary: string;
  detail?: string;
}

export interface Tool {
  def: ToolDef;
  /** Needs user confirmation unless turbo is on. */
  dangerous: boolean;
  summarize: (args: Record<string, any>) => string;
  run: (args: Record<string, any>, ctx: ToolContext) => Promise<string>;
}

const MAX_OUT = 20_000;
const isWin = process.platform === 'win32';
/** Always report paths with forward slashes (stable across OSes, matches globs). */
const toPosix = (p: string) => p.split(path.sep).join('/');

/** The shell used by run_shell: cmd.exe on Windows, the user's POSIX shell elsewhere. */
export function shellInfo(): { name: string; cmd: string; args: (command: string) => string[] } {
  if (isWin) {
    const cmd = process.env.ComSpec || 'cmd.exe';
    return { name: 'cmd.exe', cmd, args: (c) => ['/d', '/s', '/c', `"${c}"`] };
  }
  const user = process.env.SHELL ?? '';
  const ok = /(^|\/)(bash|zsh|sh|dash|ksh|fish)$/.test(user) && !user.endsWith('fish');
  const cmd = ok ? user : '/bin/sh';
  return { name: path.basename(cmd), cmd, args: (c) => ['-c', c] };
}

function killTree(pid: number | undefined) {
  if (!pid) return;
  if (isWin) {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }).on('error', () => {});
  } else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
  }
}
const clip = (s: string, n = MAX_OUT) => (s.length > n ? s.slice(0, n) + `\n…[truncated ${s.length - n} chars]` : s);
const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.venv', '__pycache__', 'target']);

function safePath(cwd: string, p: unknown): string {
  if (typeof p !== 'string' || !p) throw new Error('path is required');
  const abs = path.resolve(cwd, p);
  const rel = path.relative(cwd, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`path outside the workspace: ${p}`);
  return abs;
}

async function walk(dir: string, root: string, out: string[], limit: number) {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= limit) return;
    if (IGNORE.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, root, out, limit);
    else out.push(toPosix(path.relative(root, full)));
  }
}

function globToRegex(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export const TOOLS: Record<string, Tool> = {
  read_file: {
    dangerous: false,
    def: {
      name: 'read_file',
      description: 'Read a text file from the workspace. Returns content with line numbers.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path' },
          offset: { type: 'integer', description: 'First line (1-based), optional' },
          limit: { type: 'integer', description: 'Max lines, optional' },
        },
        required: ['path'],
      },
    },
    summarize: (a) => String(a.path),
    async run(a, ctx) {
      const text = await fs.readFile(safePath(ctx.cwd, a.path), 'utf8');
      const lines = text.replace(/\r\n/g, '\n').split('\n');
      const start = Math.max(1, Number(a.offset) || 1);
      const end = a.limit ? start + Number(a.limit) - 1 : lines.length;
      return clip(lines.slice(start - 1, end).map((l, i) => `${String(start + i).padStart(5)}  ${l}`).join('\n'));
    },
  },

  list_files: {
    dangerous: false,
    def: {
      name: 'list_files',
      description: 'List files recursively (ignores node_modules, .git, dist...). Optional glob filter like "src/**/*.ts".',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Directory, default "."' }, glob: { type: 'string' } },
      },
    },
    summarize: (a) => `${a.path ?? '.'}${a.glob ? ` ${a.glob}` : ''}`,
    async run(a, ctx) {
      const dir = safePath(ctx.cwd, a.path ?? '.');
      const out: string[] = [];
      await walk(dir, ctx.cwd, out, 2000);
      const re = a.glob ? globToRegex(String(a.glob)) : null;
      const files = re ? out.filter((f) => re.test(f)) : out;
      return files.length ? clip(files.sort().join('\n')) : '(no files)';
    },
  },

  search: {
    dangerous: false,
    def: {
      name: 'search',
      description: 'Search file contents with a regular expression. Returns path:line: text.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'JavaScript regex' },
          path: { type: 'string', description: 'Directory, default "."' },
          glob: { type: 'string', description: 'Optional file glob' },
        },
        required: ['pattern'],
      },
    },
    summarize: (a) => `/${a.pattern}/`,
    async run(a, ctx) {
      const re = new RegExp(String(a.pattern), 'i');
      const files: string[] = [];
      await walk(safePath(ctx.cwd, a.path ?? '.'), ctx.cwd, files, 5000);
      const g = a.glob ? globToRegex(String(a.glob)) : null;
      const hits: string[] = [];
      for (const f of files) {
        if (g && !g.test(f)) continue;
        let text: string;
        try {
          const buf = await fs.readFile(path.join(ctx.cwd, f));
          if (buf.includes(0)) continue;
          text = buf.toString('utf8');
        } catch {
          continue;
        }
        text.split('\n').forEach((l, i) => {
          if (hits.length < 300 && re.test(l)) hits.push(`${f}:${i + 1}: ${l.trim().slice(0, 200)}`);
        });
        if (hits.length >= 300) break;
      }
      return hits.length ? hits.join('\n') : '(no matches)';
    },
  },

  write_file: {
    dangerous: true,
    def: {
      name: 'write_file',
      description: 'Create or overwrite a file with the given content. Creates parent folders.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
      },
    },
    summarize: (a) => `${a.path} (${String(a.content ?? '').split('\n').length} lines)`,
    async run(a, ctx) {
      const p = safePath(ctx.cwd, a.path);
      const ok = await ctx.requestPermission({
        agent: ctx.agent,
        tool: 'write_file',
        summary: `Write ${a.path}`,
        detail: String(a.content ?? '').split('\n').slice(0, 12).join('\n'),
      });
      if (!ok) return 'DENIED by user.';
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, String(a.content ?? ''));
      return `Wrote ${a.path}`;
    },
  },

  edit_file: {
    dangerous: true,
    def: {
      name: 'edit_file',
      description: 'Replace an exact, unique string in a file with a new string.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          old_string: { type: 'string', description: 'Exact text to replace (must be unique)' },
          new_string: { type: 'string' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
    summarize: (a) => String(a.path),
    async run(a, ctx) {
      const p = safePath(ctx.cwd, a.path);
      const text = await fs.readFile(p, 'utf8');
      // Files with Windows line endings: models send \n, so match/replace using \r\n.
      const crlf = text.includes('\r\n');
      const fix = (v: unknown) => (crlf ? String(v).replace(/\r?\n/g, '\r\n') : String(v));
      a = { ...a, old_string: fix(a.old_string), new_string: fix(a.new_string) };
      const count = text.split(String(a.old_string)).length - 1;
      if (count === 0) return 'ERROR: old_string not found.';
      if (count > 1) return `ERROR: old_string found ${count} times; include more context.`;
      const ok = await ctx.requestPermission({
        agent: ctx.agent,
        tool: 'edit_file',
        summary: `Edit ${a.path}`,
        detail: `- ${String(a.old_string).split('\n').slice(0, 6).join('\n- ')}\n+ ${String(a.new_string).split('\n').slice(0, 6).join('\n+ ')}`,
      });
      if (!ok) return 'DENIED by user.';
      await fs.writeFile(p, text.replace(String(a.old_string), () => String(a.new_string)));
      return `Edited ${a.path}`;
    },
  },

  run_shell: {
    dangerous: true,
    def: {
      name: 'run_shell',
      description: `Run a shell command in the workspace with ${isWin ? 'cmd.exe (Windows)' : 'a POSIX shell'} (default timeout 120s). Returns exit code, stdout and stderr.`,
      parameters: {
        type: 'object',
        properties: { command: { type: 'string' }, timeout_sec: { type: 'integer' } },
        required: ['command'],
      },
    },
    summarize: (a) => String(a.command).slice(0, 80),
    async run(a, ctx) {
      const ok = await ctx.requestPermission({ agent: ctx.agent, tool: 'run_shell', summary: `$ ${a.command}` });
      if (!ok) return 'DENIED by user.';
      const timeout = Math.min(Number(a.timeout_sec) || 120, 600) * 1000;
      return new Promise((resolve) => {
        const sh = shellInfo();
        const child = spawn(sh.cmd, sh.args(String(a.command)), {
          cwd: ctx.cwd,
          env: process.env,
          windowsHide: true,
          windowsVerbatimArguments: isWin,
          detached: !isWin, // own process group so we can kill children on timeout
        });
        let out = '';
        let err = '';
        child.stdout.on('data', (d) => (out += d));
        child.stderr.on('data', (d) => (err += d));
        let killed = '';
        const kill = (why: string) => {
          killed = why;
          killTree(child.pid);
        };
        const t = setTimeout(() => kill(`timed out after ${timeout / 1000}s`), timeout);
        ctx.signal?.addEventListener('abort', () => kill('interrupted'));
        child.on('close', (code) => {
          clearTimeout(t);
          resolve(clip(`exit ${code}${killed ? ` (${killed})` : ''}\n--- stdout ---\n${out}\n--- stderr ---\n${err}`));
        });
        child.on('error', (e) => resolve(`ERROR: ${e.message}`));
      });
    },
  },
};

export const ALL_TOOL_NAMES = Object.keys(TOOLS);

/** Workspace files (posix paths, ignoring node_modules, .git, dist…) — used for @file completion. */
export async function listWorkspaceFiles(cwd: string, limit = 5000): Promise<string[]> {
  const out: string[] = [];
  await walk(cwd, cwd, out, limit);
  return out;
}
