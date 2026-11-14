import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PROVIDER_IDS, SUGGESTED_MODELS, DEFAULT_BASE_URLS, providerSettings, type Config } from '../config.js';
import { COMMANDS } from './commands.js';

export type SuggestionKind = 'command' | 'arg' | 'file' | 'history' | 'prompt';

export interface Suggestion {
  /** The whole input after accepting this suggestion. */
  value: string;
  /** What to show in the list. */
  label: string;
  hint?: string;
  kind: SuggestionKind;
}

export interface CompleteContext {
  cwd: string;
  config: Config;
  /** Workspace files (posix, relative) for @file mentions. */
  files: string[];
  /** Prompt history, most recent last. */
  history: string[];
}

const MAX = 8;

/**
 * Fuzzy score of `q` against `s` (higher is better, -1 = no match):
 * every char of q must appear in order; prefix, word-start and contiguous matches score more.
 */
export function fuzzyScore(q: string, s: string): number {
  if (!q) return 0;
  const ql = q.toLowerCase();
  const sl = s.toLowerCase();
  if (sl.startsWith(ql)) return 1000 - s.length;
  const base = sl.lastIndexOf('/') + 1;
  if (sl.startsWith(ql, base)) return 800 - s.length;
  const at = sl.indexOf(ql);
  if (at >= 0) return 600 - at - s.length;
  let score = 0;
  let j = 0;
  let prev = -2;
  for (let i = 0; i < sl.length && j < ql.length; i++) {
    if (sl[i] !== ql[j]) continue;
    score += i === prev + 1 ? 8 : 1;
    if (i === 0 || '/-_. '.includes(sl[i - 1])) score += 6;
    prev = i;
    j++;
  }
  return j === ql.length ? score : -1;
}

function rank<T>(q: string, xs: T[], key: (x: T) => string): T[] {
  return xs
    .map((x) => ({ x, s: fuzzyScore(q, key(x)) }))
    .filter((r) => r.s >= 0)
    .sort((a, b) => b.s - a.s)
    .map((r) => r.x);
}

/** Directory listing for path arguments (e.g. /google-client ~/Downloads/cli…). */
function pathCandidates(partial: string, cwd: string, ext?: string): { value: string; dir: boolean }[] {
  const expanded = partial.replace(/^~(?=$|[\\/])/, os.homedir());
  const slash = Math.max(expanded.lastIndexOf('/'), expanded.lastIndexOf('\\'));
  const dirPart = slash >= 0 ? expanded.slice(0, slash + 1) : '';
  const shownDir = slash >= 0 ? partial.slice(0, partial.length - (expanded.length - slash - 1)) : '';
  const base = expanded.slice(slash + 1);
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(path.resolve(cwd, dirPart || '.'), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => (base.startsWith('.') || !e.name.startsWith('.')) && (e.isDirectory() || !ext || e.name.endsWith(ext)))
    .filter((e) => e.name.toLowerCase().startsWith(base.toLowerCase()))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .map((e) => ({ value: shownDir + e.name + (e.isDirectory() ? '/' : ''), dir: e.isDirectory() }));
}

/** Starter prompts based on what the workspace contains. */
export function starterPrompts(cwd: string): string[] {
  const has = (f: string) => fs.existsSync(path.join(cwd, f));
  const out: string[] = [];
  let empty = false;
  try {
    empty = fs.readdirSync(cwd).filter((f) => !f.startsWith('.')).length === 0;
  } catch {
    /* unreadable */
  }
  if (empty) {
    out.push('Create a new project here: ', 'Build a small web app with a REST API and tests');
    return out;
  }
  out.push('Explain how this project is structured');
  if (has('package.json')) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
      if (pkg.scripts?.test) out.push('Run the tests and fix whatever fails');
      if (pkg.scripts?.build) out.push('Run the build and fix the errors');
    } catch {
      /* invalid json */
    }
  }
  if (has('.git')) out.push('Review my uncommitted changes and point out bugs');
  if (!has('README.md')) out.push('Write a README for this project');
  out.push('Find bugs in ', 'Add tests for ');
  return out.slice(0, 5);
}

/** Suggestions for the current input. */
export function complete(input: string, ctx: CompleteContext): Suggestion[] {
  // --- slash commands ------------------------------------------------------
  if (input.startsWith('/')) {
    const sp = input.indexOf(' ');
    if (sp < 0) {
      return rank(input.slice(1), COMMANDS, (c) => c.name.slice(1))
        .slice(0, MAX)
        .map((c) => ({ value: c.name + (c.args ? ' ' : ''), label: c.name, hint: (c.args ? c.args + ' — ' : '') + c.desc, kind: 'command' }));
    }
    const cmd = input.slice(0, sp);
    const rest = input.slice(sp + 1);
    const parts = rest.split(/\s+/);
    const argIdx = parts.length - 1;
    const cur = parts[argIdx];
    const prefix = input.slice(0, input.length - cur.length);
    const opts = (vals: { v: string; hint?: string }[], space = true): Suggestion[] =>
      rank(cur, vals, (x) => x.v)
        .slice(0, MAX)
        .map((x) => ({ value: prefix + x.v + (space ? ' ' : ''), label: x.v, hint: x.hint, kind: 'arg' }));
    const providers = () =>
      PROVIDER_IDS.map((p) => ({ v: p, hint: providerSettings(ctx.config, p).apiKey ? 'key saved ✔' : 'no key yet' }));
    switch (cmd) {
      case '/key':
        return argIdx === 0 ? opts(providers()) : [];
      case '/baseurl':
        if (argIdx === 0) return opts(providers());
        if (argIdx === 1) return opts([{ v: DEFAULT_BASE_URLS[parts[0] as keyof typeof DEFAULT_BASE_URLS] ?? '', hint: 'default' }], false);
        return [];
      case '/model': {
        if (argIdx === 0)
          return opts([
            { v: 'orchestrator', hint: `now ${ctx.config.orchestrator.provider}:${ctx.config.orchestrator.model}` },
            { v: 'sub', hint: `now ${ctx.config.subagent.provider}:${ctx.config.subagent.model}` },
          ]);
        if (argIdx === 1) {
          const all = PROVIDER_IDS.flatMap((p) =>
            SUGGESTED_MODELS[p].map((m) => ({ v: `${p}:${m}`, hint: providerSettings(ctx.config, p).apiKey || p === 'custom' ? 'ready' : 'needs a key' })),
          );
          // models of providers that are ready first
          all.sort((a, b) => Number(b.hint === 'ready') - Number(a.hint === 'ready'));
          return opts(all, false);
        }
        return [];
      }
      case '/turbo':
        return argIdx === 0 ? opts([{ v: 'on', hint: 'no confirmations' }, { v: 'off', hint: 'ask before writing / running' }], false) : [];
      case '/parallel':
        return argIdx === 0 ? opts(['2', '4', '8', '16'].map((v) => ({ v, hint: v === String(ctx.config.maxParallel) ? 'current' : undefined })), false) : [];
      case '/login':
      case '/project': {
        const p = ctx.config.google.quotaProject;
        return argIdx === 0 && p ? opts([{ v: p, hint: 'current project' }], false) : [];
      }
      case '/google-client':
        if (argIdx !== 0) return [];
        return pathCandidates(cur, ctx.cwd, '.json')
          .slice(0, MAX)
          .map((c) => ({ value: prefix + c.value, label: c.value, hint: c.dir ? 'folder' : undefined, kind: 'file' }));
      case '/help':
        return [];
      default:
        return [];
    }
  }

  // --- @file mentions ------------------------------------------------------
  const m = /(^|\s)@([^\s]*)$/.exec(input);
  if (m) {
    const q = m[2];
    const before = input.slice(0, input.length - q.length);
    return rank(q, ctx.files, (f) => f)
      .slice(0, MAX)
      .map((f) => ({ value: before + f + ' ', label: '@' + f, kind: 'file' }));
  }

  // --- history -------------------------------------------------------------
  if (input.trim().length >= 2) {
    const seen = new Set<string>();
    const out: Suggestion[] = [];
    for (let i = ctx.history.length - 1; i >= 0 && out.length < 3; i--) {
      const h = ctx.history[i];
      if (h !== input && h.toLowerCase().startsWith(input.toLowerCase()) && !seen.has(h)) {
        seen.add(h);
        out.push({ value: h, label: h, hint: 'history', kind: 'history' });
      }
    }
    return out;
  }
  return [];
}

/** The part of the top suggestion that extends what was typed (shown dimmed after the cursor). */
export function ghostText(input: string, s?: Suggestion): string {
  if (!s || !input) return '';
  return s.value.toLowerCase().startsWith(input.toLowerCase()) ? s.value.slice(input.length) : '';
}

/** Expands @file mentions into a note so the model knows which files the user means. */
export function describeMentions(text: string, files: string[]): string {
  const set = new Set(files);
  const mentioned = [...text.matchAll(/(?:^|\s)@([^\s]+)/g)].map((x) => x[1]).filter((f) => set.has(f));
  if (!mentioned.length) return text;
  return `${text}\n\n(Files referenced with @: ${[...new Set(mentioned)].join(', ')} — paths relative to the workspace.)`;
}
