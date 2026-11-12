import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Static, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { Orchestrator, type JustEvent } from '../agents/orchestrator.js';
import {
  CONFIG_FILE,
  PROVIDER_IDS,
  SUGGESTED_MODELS,
  fmtRef,
  googleOAuth,
  parseModelRef,
  providerSettings,
  saveConfig,
  type Config,
  type ProviderId,
} from '../config.js';
import { googleAccount, googleLogin, googleLogout, isGoogleLoggedIn } from '../auth/google.js';
import type { PermissionRequest } from '../tools/index.js';
import { AgentPanel, type AgentView } from './AgentPanel.js';
import { AnimatedLogo, StaticLogo } from './Logo.js';
import { Markdown } from './Markdown.js';
import { PermissionPrompt, type PermissionAnswer } from './Permission.js';
import { TurboBurst } from './Turbo.js';
import { C, lerpColors, RAINBOW } from './theme.js';
import { useTick } from './hooks.js';

type Item =
  | { id: number; kind: 'header' }
  | { id: number; kind: 'user'; text: string }
  | { id: number; kind: 'assistant'; text: string }
  | { id: number; kind: 'info'; text: string; color?: string }
  | { id: number; kind: 'error'; text: string }
  | { id: number; kind: 'tool'; agent: string; name: string; summary: string }
  | { id: number; kind: 'agents'; agents: AgentView[] };

type NewItem = Item extends infer T ? (T extends Item ? Omit<T, 'id'> : never) : never;

const COMMANDS: [string, string][] = [
  ['/help', 'show commands'],
  ['/login', 'log in with your Google account (Gemini)'],
  ['/logout', 'log out of Google'],
  ['/google-client', '<client_id> <client_secret> [quota_project] — set the OAuth client'],
  ['/key', '<provider> <api_key> — save an API key (groq, openrouter, openai, gemini, custom)'],
  ['/baseurl', '<provider> <url> — custom OpenAI-compatible endpoint'],
  ['/model', '<orchestrator|sub> <provider:model> — choose models'],
  ['/models', 'list suggested models'],
  ['/turbo', 'toggle TURBO mode (no confirmations)'],
  ['/parallel', '<n> — max sub-agents running at once'],
  ['/status', 'show configuration'],
  ['/clear', 'clear the conversation'],
  ['/exit', 'quit'],
];

interface Pending {
  req: PermissionRequest;
  resolve: (ok: boolean) => void;
}

export function App({ initialConfig, cwd, initialPrompt }: { initialConfig: Config; cwd: string; initialPrompt?: string }) {
  const { exit } = useApp();
  const [config, setConfigState] = useState(initialConfig);
  const cfgRef = useRef(config);
  const setConfig = useCallback((c: Config) => {
    cfgRef.current = c;
    setConfigState(c);
    try {
      saveConfig(c);
    } catch {
      /* read-only home */
    }
  }, []);

  const [items, setItems] = useState<Item[]>([]);
  const idRef = useRef(0);
  const push = useCallback((it: NewItem) => setItems((xs) => [...xs, { ...it, id: ++idRef.current } as Item]), []);

  const [splash, setSplash] = useState(true);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [orchStatus, setOrchStatus] = useState('thinking…');
  const [agents, setAgents] = useState<AgentView[]>([]);
  const agentsRef = useRef<AgentView[]>([]);
  const [queue, setQueue] = useState<Pending[]>([]);
  const [turboAnim, setTurboAnim] = useState(false);
  const [tokens, setTokens] = useState({ input: 0, output: 0 });
  const [account, setAccount] = useState(googleAccount());
  const always = useRef(new Set<string>());
  const ctrlC = useRef(0);
  const loginAbort = useRef<AbortController | null>(null);

  const updateAgents = (fn: (a: AgentView[]) => AgentView[]) => {
    agentsRef.current = fn(agentsRef.current);
    setAgents(agentsRef.current);
  };

  const requestPermission = useCallback((req: PermissionRequest) => {
    if (cfgRef.current.turbo || always.current.has(req.tool)) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => setQueue((q) => [...q, { req, resolve }]));
  }, []);

  const orch = useMemo(() => new Orchestrator({ cwd, getConfig: () => cfgRef.current, requestPermission }), [cwd, requestPermission]);

  // --- orchestrator events -------------------------------------------------
  useEffect(() => {
    const on = (e: JustEvent) => {
      switch (e.type) {
        case 'orch:thinking':
          setOrchStatus('thinking…');
          break;
        case 'orch:text':
          push({ kind: 'assistant', text: e.text });
          break;
        case 'orch:tool':
          if (e.name === 'spawn_agents') setOrchStatus(`delegating to ${e.summary}…`);
          else push({ kind: 'tool', agent: 'orchestrator', name: e.name, summary: e.summary });
          break;
        case 'agent:spawn':
          updateAgents((a) => [
            ...a,
            { id: e.id, name: e.name, task: e.task, model: e.model, status: 'queued', activity: e.task.split('\n')[0].slice(0, 70), tools: 0, start: Date.now() },
          ]);
          break;
        case 'agent:start':
          updateAgents((a) => a.map((x) => (x.id === e.id ? { ...x, status: 'running', start: Date.now() } : x)));
          break;
        case 'agent:tool':
          updateAgents((a) => a.map((x) => (x.id === e.id ? { ...x, tools: x.tools + 1, activity: `${e.name} ${e.summary}` } : x)));
          break;
        case 'agent:done':
          updateAgents((a) =>
            a.map((x) => (x.id === e.id ? { ...x, status: 'done', end: Date.now(), activity: e.result.replace(/\s+/g, ' ').slice(0, 90) } : x)),
          );
          setOrchStatus('reviewing reports…');
          break;
        case 'agent:error':
          updateAgents((a) => a.map((x) => (x.id === e.id ? { ...x, status: 'error', end: Date.now(), activity: e.error.slice(0, 90) } : x)));
          break;
        case 'usage':
          setTokens((t) => ({ input: t.input + e.input, output: t.output + e.output }));
          break;
      }
    };
    orch.on('event', on);
    return () => {
      orch.off('event', on);
    };
  }, [orch, push]);

  // --- splash --------------------------------------------------------------
  useEffect(() => {
    const t = setTimeout(() => {
      setSplash(false);
      push({ kind: 'header' });
      if (initialConfig.orchestrator.provider === 'gemini' && !isGoogleLoggedIn() && !providerSettings(initialConfig, 'gemini').apiKey)
        push({ kind: 'info', text: 'Not connected to Gemini yet → type /login to sign in with Google.', color: C.yellow });
      if (initialConfig.turbo) setTurboAnim(true);
      if (initialPrompt) void submit(initialPrompt);
    }, 1700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- turbo ---------------------------------------------------------------
  const setTurbo = (on: boolean) => {
    setConfig({ ...cfgRef.current, turbo: on });
    if (on) {
      setTurboAnim(true);
      setQueue((q) => {
        q.forEach((p) => p.resolve(true));
        return [];
      });
    } else push({ kind: 'info', text: '🔒 Turbo off — dangerous actions will ask for confirmation.', color: C.gray });
  };

  const answer = (a: PermissionAnswer) => {
    const [first, ...rest] = queue;
    if (!first) return;
    if (a === 'turbo') return setTurbo(true);
    if (a === 'always') always.current.add(first.req.tool);
    first.resolve(a !== 'no');
    // "always" also releases queued requests for the same tool
    const remaining = a === 'always' ? rest.filter((p) => (p.req.tool === first.req.tool ? (p.resolve(true), false) : true)) : rest;
    setQueue(remaining);
  };

  // --- keys ----------------------------------------------------------------
  useInput((ch, key) => {
    if (key.ctrl && ch === 'c') {
      if (busy) {
        orch.interrupt();
        push({ kind: 'info', text: '⏹  interrupted', color: C.yellow });
        return;
      }
      if (++ctrlC.current >= 2) exit();
      else {
        push({ kind: 'info', text: 'Press Ctrl+C again to quit.', color: C.dim });
        setTimeout(() => (ctrlC.current = 0), 1500);
      }
      return;
    }
    if (key.escape && busy && !queue.length) {
      orch.interrupt();
      loginAbort.current?.abort();
      push({ kind: 'info', text: '⏹  interrupted', color: C.yellow });
    }
    if (key.tab && input.startsWith('/')) {
      const m = COMMANDS.find(([c]) => c.startsWith(input));
      if (m) setInput(m[0] + ' ');
    }
  });

  // --- commands ------------------------------------------------------------
  const command = async (line: string) => {
    const [cmd, ...args] = line.trim().split(/\s+/);
    const cfg = cfgRef.current;
    switch (cmd) {
      case '/help':
        push({ kind: 'info', text: COMMANDS.map(([c, d]) => `${c.padEnd(15)} ${d}`).join('\n') });
        break;
      case '/exit':
      case '/quit':
        exit();
        break;
      case '/clear':
        orch.reset();
        push({ kind: 'info', text: '✨ conversation cleared', color: C.gray });
        break;
      case '/turbo':
        setTurbo(args[0] ? args[0] === 'on' : !cfg.turbo);
        break;
      case '/login': {
        const g = googleOAuth(cfg);
        loginAbort.current = new AbortController();
        setBusy(true);
        setOrchStatus('waiting for Google login in the browser…');
        try {
          const email = await googleLogin(g, (url) => push({ kind: 'info', text: `🌐 Opening the browser to sign in with Google.\nIf it does not open, visit:\n${url}`, color: C.blue }), loginAbort.current.signal);
          setAccount(email);
          push({ kind: 'info', text: `✔ Logged in with Google${email ? ` as ${email}` : ''}. Gemini is ready.`, color: C.green });
        } catch (e) {
          push({ kind: 'error', text: (e as Error).message });
        } finally {
          setBusy(false);
          loginAbort.current = null;
        }
        break;
      }
      case '/logout':
        push({ kind: 'info', text: googleLogout() ? 'Logged out of Google.' : 'Not logged in.', color: C.gray });
        setAccount(undefined);
        break;
      case '/google-client':
        if (!args[0]) return push({ kind: 'error', text: 'Usage: /google-client <client_id> <client_secret> [quota_project]' });
        setConfig({ ...cfg, google: { clientId: args[0], clientSecret: args[1], quotaProject: args[2] } });
        push({ kind: 'info', text: '✔ Google OAuth client saved. Now run /login.', color: C.green });
        break;
      case '/key': {
        const p = args[0] as ProviderId;
        if (!PROVIDER_IDS.includes(p) || !args[1]) return push({ kind: 'error', text: `Usage: /key <${PROVIDER_IDS.join('|')}> <api_key>` });
        setConfig({ ...cfg, providers: { ...cfg.providers, [p]: { ...cfg.providers[p], apiKey: args[1] } } });
        push({ kind: 'info', text: `✔ API key for ${p} saved in ${CONFIG_FILE}`, color: C.green });
        break;
      }
      case '/baseurl': {
        const p = args[0] as ProviderId;
        if (!PROVIDER_IDS.includes(p) || !args[1]) return push({ kind: 'error', text: 'Usage: /baseurl <provider> <url>' });
        setConfig({ ...cfg, providers: { ...cfg.providers, [p]: { ...cfg.providers[p], baseUrl: args[1] } } });
        push({ kind: 'info', text: `✔ ${p} → ${args[1]}`, color: C.green });
        break;
      }
      case '/model': {
        const which = args[0];
        const ref = args[1] ? parseModelRef(args[1]) : null;
        if (!['orchestrator', 'sub'].includes(which) || !ref)
          return push({ kind: 'error', text: 'Usage: /model <orchestrator|sub> <provider:model>   e.g. /model sub groq:llama-3.3-70b-versatile' });
        setConfig(which === 'sub' ? { ...cfg, subagent: ref } : { ...cfg, orchestrator: ref });
        push({ kind: 'info', text: `✔ ${which} → ${fmtRef(ref)}`, color: C.green });
        break;
      }
      case '/models':
        push({ kind: 'info', text: PROVIDER_IDS.map((p) => `${p.padEnd(11)} ${SUGGESTED_MODELS[p].join(', ')}`).join('\n') + '\n(any model id supported by the provider works)' });
        break;
      case '/parallel': {
        const n = Number(args[0]);
        if (!(n >= 1 && n <= 32)) return push({ kind: 'error', text: 'Usage: /parallel <1-32>' });
        setConfig({ ...cfg, maxParallel: n });
        push({ kind: 'info', text: `✔ up to ${n} sub-agents in parallel`, color: C.green });
        break;
      }
      case '/status': {
        const keys = PROVIDER_IDS.map((p) => `${p}:${providerSettings(cfg, p).apiKey ? '✔' : '·'}`).join('  ');
        push({
          kind: 'info',
          text:
            `orchestrator  ${fmtRef(cfg.orchestrator)}\nsub-agents    ${fmtRef(cfg.subagent)}  (max ${cfg.maxParallel} parallel)\n` +
            `google login  ${isGoogleLoggedIn() ? `✔ ${googleAccount() ?? ''}` : '✘ (/login)'}\napi keys      ${keys}\n` +
            `turbo         ${cfg.turbo ? 'ON ⚡' : 'off'}\nworkspace     ${cwd}\nconfig        ${CONFIG_FILE}`,
        });
        break;
      }
      default:
        push({ kind: 'error', text: `Unknown command ${cmd}. Type /help.` });
    }
  };

  const submit = async (raw: string) => {
    const text = raw.trim();
    setInput('');
    if (!text) return;
    if (text.startsWith('/')) return command(text);
    if (busy) return;
    push({ kind: 'user', text });
    setBusy(true);
    agentsRef.current = [];
    setAgents([]);
    try {
      const answerText = await orch.send(text);
      if (agentsRef.current.length) push({ kind: 'agents', agents: agentsRef.current });
      if (answerText.trim()) push({ kind: 'assistant', text: answerText });
    } catch (e) {
      if (agentsRef.current.length) push({ kind: 'agents', agents: agentsRef.current });
      push({ kind: 'error', text: (e as Error).message });
    } finally {
      agentsRef.current = [];
      setAgents([]);
      setBusy(false);
    }
  };

  const suggestions = input.startsWith('/') && !input.includes(' ') ? COMMANDS.filter(([c]) => c.startsWith(input)) : [];

  if (splash)
    return (
      <Box paddingX={1} paddingY={1}>
        <AnimatedLogo subtitle="orchestrator + parallel sub-agents · Gemini · Groq · OpenRouter · any API" />
      </Box>
    );

  return (
    <Box flexDirection="column">
      <Static items={items}>{(it) => <ItemView key={it.id} it={it} config={config} cwd={cwd} />}</Static>

      {turboAnim && (
        <TurboBurst
          onDone={() => {
            setTurboAnim(false);
            push({ kind: 'info', text: '⚡ TURBO ON — agents write files and run commands without asking. /turbo to turn off.', color: C.orange });
          }}
        />
      )}

      {busy && <AgentPanel agents={agents} orchStatus={orchStatus} model={fmtRef(config.orchestrator)} />}

      {queue.length > 0 && !turboAnim && <PermissionPrompt req={queue[0].req} queued={queue.length - 1} onAnswer={answer} />}

      {!busy && queue.length === 0 && (
        <Box flexDirection="column">
          <Box borderStyle="round" borderColor={config.turbo ? C.orange : C.dim} paddingX={1}>
            <Text color={C.orange} bold>
              {'❯ '}
            </Text>
            <TextInput value={input} onChange={setInput} onSubmit={submit} placeholder="Ask just-Code to build something…  (/help)" />
          </Box>
          {suggestions.map(([c, d]) => (
            <Text key={c}>
              {'  '}
              <Text color={C.orange}>{c.padEnd(15)}</Text>
              <Text color={C.dim}>{d}</Text>
            </Text>
          ))}
        </Box>
      )}
      <StatusBar config={config} tokens={tokens} account={account} />
    </Box>
  );
}

function StatusBar({ config, tokens, account }: { config: Config; tokens: { input: number; output: number }; account?: string }) {
  const tick = useTick(120, config.turbo);
  return (
    <Box paddingX={1} justifyContent="space-between">
      <Text color={C.dim}>
        <Text color={C.gray}>⬢ {fmtRef(config.orchestrator)}</Text> → <Text color={C.gray}>{fmtRef(config.subagent)}</Text> ×{config.maxParallel}
        {account ? `  · ${account}` : ''}
      </Text>
      <Text>
        <Text color={C.dim}>{`↑${tokens.input} ↓${tokens.output}  `}</Text>
        {config.turbo ? (
          <Text bold color={lerpColors(RAINBOW, tick / 20)}>
            ⚡ TURBO
          </Text>
        ) : (
          <Text color={C.dim}>🔒 ask</Text>
        )}
      </Text>
    </Box>
  );
}

function ItemView({ it, config, cwd }: { it: Item; config: Config; cwd: string }) {
  switch (it.kind) {
    case 'header':
      return (
        <Box paddingX={1} paddingTop={1}>
          <StaticLogo
            lines={[
              <Text color={C.gray}>orchestrator + parallel sub-agents</Text>,
              <Text color={C.dim}>{cwd}</Text>,
              <Text color={C.dim}>
                /help for commands · /login for Gemini · <Text color={C.orange}>/turbo</Text> for full autonomy
              </Text>,
            ]}
          />
        </Box>
      );
    case 'user':
      return (
        <Box marginTop={1} paddingX={1}>
          <Text color={C.orange} bold>
            {'❯ '}
          </Text>
          <Text color={C.white}>{it.text}</Text>
        </Box>
      );
    case 'assistant':
      return (
        <Box marginTop={1} paddingX={1}>
          <Text color={C.white}>{'⏺ '}</Text>
          <Box flexDirection="column" flexGrow={1}>
            <Markdown text={it.text} />
          </Box>
        </Box>
      );
    case 'tool':
      return (
        <Box paddingX={1}>
          <Text color={C.dim}>
            {'  ⎿ '}
            <Text color={C.gray}>{it.name}</Text> {it.summary}
          </Text>
        </Box>
      );
    case 'agents':
      return (
        <Box flexDirection="column" paddingX={1} marginTop={1}>
          <Text color={C.gray}>{`  ⎿ ${it.agents.length} sub-agents`}</Text>
          {it.agents.map((a) => (
            <Text key={a.id} color={C.dim}>
              {'     '}
              <Text color={a.status === 'done' ? C.green : C.red}>{a.status === 'done' ? '✔' : '✘'}</Text> <Text color={C.white}>{a.name}</Text>{' '}
              {`${a.model} · ${(((a.end ?? Date.now()) - a.start) / 1000).toFixed(1)}s · ${a.tools} tools`}
            </Text>
          ))}
        </Box>
      );
    case 'info':
      return (
        <Box paddingX={1} marginTop={1}>
          <Text color={it.color ?? C.gray}>{it.text}</Text>
        </Box>
      );
    case 'error':
      return (
        <Box paddingX={1} marginTop={1}>
          <Text color={C.red}>✘ {it.text}</Text>
        </Box>
      );
  }
  void config;
}
