import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Orchestrator } from '../agents/orchestrator.js';
import { googleAccount, googleLogin, googleLogout, isGoogleLoggedIn } from '../auth/google.js';
import {
  CONFIG_FILE,
  PROVIDER_IDS,
  SUGGESTED_MODELS,
  fmtRef,
  googleOAuth,
  parseModelRef,
  providerSettings,
  type Config,
  type ProviderId,
} from '../config.js';
import { NEED_PROJECT } from '../providers/gemini.js';

/** Slash commands shared by the terminal UI and the GUI. */
export interface CommandSpec {
  name: string;
  args?: string;
  desc: string;
}

export const COMMANDS: CommandSpec[] = [
  { name: '/help', desc: 'show commands' },
  { name: '/setup', desc: 'guided setup: provider, key, models, permissions' },
  { name: '/key', args: '<provider> <api_key>', desc: 'save an API key (gemini, groq, openrouter, openai, custom)' },
  { name: '/model', args: '<orchestrator|sub> <provider:model>', desc: 'choose models' },
  { name: '/models', desc: 'list suggested models' },
  { name: '/turbo', args: '[on|off]', desc: 'toggle TURBO mode (no confirmations)' },
  { name: '/parallel', args: '<n>', desc: 'max sub-agents running at once' },
  { name: '/status', desc: 'show configuration' },
  { name: '/login', args: '[project-id]', desc: 'sign in with Google; usage billed to your own Cloud project' },
  { name: '/project', args: '<project-id>', desc: 'Google Cloud project used with the Google login' },
  { name: '/logout', desc: 'sign out of Google' },
  { name: '/google-client', args: '<client_secret.json>', desc: 'use your own Google OAuth client' },
  { name: '/baseurl', args: '<provider> <url>', desc: 'custom OpenAI-compatible endpoint' },
  { name: '/clear', desc: 'clear the conversation' },
  { name: '/exit', desc: 'quit' },
];

export type Tone = 'info' | 'ok' | 'warn' | 'error' | 'accent' | 'link';

export interface CommandHost {
  cwd: string;
  orch: Orchestrator;
  getConfig(): Config;
  setConfig(c: Config): void;
  say(text: string, tone?: Tone): void;
  setTurbo(on: boolean): void;
  setBusy(busy: boolean, status?: string): void;
  /** Abort signal for a long command (Google login); the host cancels it on Esc / Stop. */
  newAbort(): AbortSignal;
  onAccount?(email?: string): void;
  openSetup?(): void;
  exit?(): void;
}

export const helpText = () => COMMANDS.map((c) => `${(c.name + (c.args ? ' ' + c.args : '')).padEnd(38)} ${c.desc}`).join('\n');

export function statusText(cfg: Config, cwd: string): string {
  const keys = PROVIDER_IDS.map((p) => `${p}:${providerSettings(cfg, p).apiKey ? '✔' : '·'}`).join('  ');
  return (
    `orchestrator  ${fmtRef(cfg.orchestrator)}\nsub-agents    ${fmtRef(cfg.subagent)}  (max ${cfg.maxParallel} parallel)\n` +
    `google login  ${isGoogleLoggedIn() ? `✔ ${googleAccount() ?? ''}` : '✘'}  project ${googleOAuth(cfg).quotaProject ?? '—'}\n` +
    `api keys      ${keys}\nturbo         ${cfg.turbo ? 'ON ⚡' : 'off'}\nworkspace     ${cwd}\nconfig        ${CONFIG_FILE}`
  );
}

export async function runCommand(line: string, h: CommandHost): Promise<void> {
  const [cmd, ...args] = line.trim().split(/\s+/);
  const cfg = h.getConfig();
  switch (cmd) {
    case '/help':
      return h.say(helpText());
    case '/exit':
    case '/quit':
      if (h.exit) h.exit();
      else h.say('Close the window to quit.');
      return;
    case '/setup':
      if (h.openSetup) h.openSetup();
      return;
    case '/clear':
      h.orch.reset();
      return h.say('✨ conversation cleared');
    case '/turbo':
      return h.setTurbo(args[0] ? args[0] === 'on' : !cfg.turbo);
    case '/login': {
      let next = cfg;
      if (args[0]) {
        next = { ...cfg, google: { ...cfg.google, quotaProject: args[0] } };
        h.setConfig(next);
      }
      const g = googleOAuth(next);
      h.setBusy(true, 'waiting for Google login in the browser…');
      try {
        const email = await googleLogin(
          g,
          (url) => h.say(`🌐 Opening the browser to sign in with Google.\nIf it does not open, visit:\n${url}`, 'link'),
          h.newAbort(),
        );
        h.onAccount?.(email);
        h.say(`✔ Logged in with Google${email ? ` as ${email}` : ''}.`, 'ok');
        if (g.quotaProject) h.say(`Gemini is ready — usage billed to your project ${g.quotaProject}.`, 'ok');
        else h.say(NEED_PROJECT, 'warn');
      } catch (e) {
        h.say((e as Error).message, 'error');
      } finally {
        h.setBusy(false);
      }
      return;
    }
    case '/project':
      if (!args[0]) return h.say('Usage: /project <google-cloud-project-id>', 'error');
      h.setConfig({ ...cfg, google: { ...cfg.google, quotaProject: args[0] } });
      return h.say(`✔ Google login usage now billed to project ${args[0]}.`, 'ok');
    case '/logout':
      h.say(googleLogout() ? 'Logged out of Google.' : 'Not logged in.');
      h.onAccount?.(undefined);
      return;
    case '/google-client': {
      if (!args[0]) return h.say('Usage: /google-client <client_secret.json> | <client_id> <client_secret> [quota_project]', 'error');
      let google = { clientId: args[0], clientSecret: args[1], quotaProject: args[2] };
      if (args[0].endsWith('.json')) {
        try {
          const file = args[0].replace(/^~(?=[\\/])/, os.homedir());
          const j = JSON.parse(fs.readFileSync(path.resolve(h.cwd, file), 'utf8'));
          const c = j.installed ?? j.web ?? j;
          google = { clientId: c.client_id, clientSecret: c.client_secret, quotaProject: args[1] ?? c.project_id };
        } catch (e) {
          return h.say(`Cannot read ${args[0]}: ${(e as Error).message}`, 'error');
        }
      }
      h.setConfig({ ...cfg, google });
      return h.say('✔ Google OAuth client saved. Now run /login.', 'ok');
    }
    case '/key': {
      const p = args[0] as ProviderId;
      if (!PROVIDER_IDS.includes(p) || !args[1]) return h.say(`Usage: /key <${PROVIDER_IDS.join('|')}> <api_key>`, 'error');
      h.setConfig({ ...cfg, providers: { ...cfg.providers, [p]: { ...cfg.providers[p], apiKey: args[1] } } });
      return h.say(`✔ API key for ${p} saved in ${CONFIG_FILE}`, 'ok');
    }
    case '/baseurl': {
      const p = args[0] as ProviderId;
      if (!PROVIDER_IDS.includes(p) || !args[1]) return h.say('Usage: /baseurl <provider> <url>', 'error');
      h.setConfig({ ...cfg, providers: { ...cfg.providers, [p]: { ...cfg.providers[p], baseUrl: args[1] } } });
      return h.say(`✔ ${p} → ${args[1]}`, 'ok');
    }
    case '/model': {
      const which = args[0];
      const ref = args[1] ? parseModelRef(args[1]) : null;
      if (!['orchestrator', 'sub'].includes(which) || !ref)
        return h.say('Usage: /model <orchestrator|sub> <provider:model>   e.g. /model sub groq:llama-3.3-70b-versatile', 'error');
      h.setConfig(which === 'sub' ? { ...cfg, subagent: ref } : { ...cfg, orchestrator: ref });
      return h.say(`✔ ${which} → ${fmtRef(ref)}`, 'ok');
    }
    case '/models':
      return h.say(
        PROVIDER_IDS.map((p) => `${p.padEnd(11)} ${SUGGESTED_MODELS[p].join(', ')}`).join('\n') + '\n(any model id supported by the provider works)',
      );
    case '/parallel': {
      const n = Number(args[0]);
      if (!(n >= 1 && n <= 32)) return h.say('Usage: /parallel <1-32>', 'error');
      h.setConfig({ ...cfg, maxParallel: n });
      return h.say(`✔ up to ${n} sub-agents in parallel`, 'ok');
    }
    case '/status':
      return h.say(statusText(cfg, h.cwd));
    default: {
      const near = COMMANDS.filter((c) => c.name.startsWith(cmd.slice(0, 3))).map((c) => c.name);
      return h.say(`Unknown command ${cmd}.${near.length ? ` Did you mean ${near.join(', ')}?` : ''} Type /help.`, 'error');
    }
  }
}
