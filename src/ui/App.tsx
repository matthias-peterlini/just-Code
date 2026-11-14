import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Static, Text, useApp, useInput } from 'ink';
import { Orchestrator, type JustEvent } from '../agents/orchestrator.js';
import { fmtRef, saveConfig, type Config } from '../config.js';
import { NOT_CONNECTED } from '../providers/gemini.js';
import { googleAccount } from '../auth/google.js';
import { runCommand, type Tone } from '../core/commands.js';
import { describeMentions, starterPrompts, type CompleteContext } from '../core/complete.js';
import { PromptHistory } from '../core/history.js';
import { hasCredentials, needsSetup } from '../core/setup.js';
import { listWorkspaceFiles } from '../tools/index.js';
import { PromptInput } from './PromptInput.js';
import { Setup } from './Setup.js';
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

const TONE: Record<Tone, string> = { info: C.gray, ok: C.green, warn: C.yellow, error: C.red, accent: C.orange, link: C.blue };

interface Pending {
  req: PermissionRequest;
  resolve: (ok: boolean) => void;
}

export function App({ initialConfig, cwd, initialPrompt, forceSetup }: { initialConfig: Config; cwd: string; initialPrompt?: string; forceSetup?: boolean }) {
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
  const [setup, setSetup] = useState(false);
  const history = useMemo(() => new PromptHistory(), []);
  const [files, setFiles] = useState<string[]>([]);
  const [started, setStarted] = useState(false);
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
      if (forceSetup || needsSetup(initialConfig)) setSetup(true);
      else if (initialConfig.orchestrator.provider === 'gemini' && !hasCredentials(initialConfig))
        push({ kind: 'info', text: NOT_CONNECTED + '  (or /setup)', color: C.yellow });
      if (initialConfig.turbo) setTurboAnim(true);
      if (initialPrompt) void submit(initialPrompt);
    }, 1700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // workspace files for @mentions (refreshed after every turn)
  const refreshFiles = useCallback(() => {
    void listWorkspaceFiles(cwd).then(setFiles);
  }, [cwd]);
  useEffect(refreshFiles, [refreshFiles]);
  const completeCtx: CompleteContext = useMemo(() => ({ cwd, config, files, history: history.items }), [cwd, config, files, history, started, busy]);
  const starters = useMemo(() => (started ? [] : starterPrompts(cwd)), [cwd, started]);

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
  });

  // --- commands ------------------------------------------------------------
  const command = (line: string) =>
    runCommand(line, {
      cwd,
      orch,
      getConfig: () => cfgRef.current,
      setConfig,
      say: (text, tone = 'info') => push(tone === 'error' ? { kind: 'error', text } : { kind: 'info', text, color: TONE[tone] }),
      setTurbo,
      setBusy: (b, status) => {
        setBusy(b);
        if (status) setOrchStatus(status);
        if (!b) loginAbort.current = null;
      },
      newAbort: () => {
        loginAbort.current = new AbortController();
        return loginAbort.current.signal;
      },
      onAccount: setAccount,
      openSetup: () => setSetup(true),
      exit,
    });

  const submit = async (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    history.add(text);
    if (text.startsWith('/')) return command(text);
    if (busy) return;
    setStarted(true);
    push({ kind: 'user', text });
    setBusy(true);
    agentsRef.current = [];
    setAgents([]);
    try {
      const answerText = await orch.send(describeMentions(text, files));
      if (agentsRef.current.length) push({ kind: 'agents', agents: agentsRef.current });
      if (answerText.trim()) push({ kind: 'assistant', text: answerText });
    } catch (e) {
      if (agentsRef.current.length) push({ kind: 'agents', agents: agentsRef.current });
      push({ kind: 'error', text: (e as Error).message });
    } finally {
      agentsRef.current = [];
      setAgents([]);
      setBusy(false);
      refreshFiles();
    }
  };

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

      {setup && (
        <Setup
          config={config}
          onCancel={() => {
            setSetup(false);
            push({ kind: 'info', text: 'Setup skipped — run /setup any time.', color: C.gray });
          }}
          onDone={(c) => {
            setSetup(false);
            setConfig(c);
            push({
              kind: 'info',
              text: `✔ All set!  orchestrator ${fmtRef(c.orchestrator)} → sub-agents ${fmtRef(c.subagent)} · ${c.turbo ? '⚡ TURBO' : '🔒 ask before acting'}`,
              color: C.green,
            });
            if (c.turbo) setTurboAnim(true);
          }}
        />
      )}

      {!busy && !setup && queue.length === 0 && <PromptInput ctx={completeCtx} starters={starters} turbo={config.turbo} onSubmit={submit} />}
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

export function ItemView({ it, config, cwd }: { it: Item; config: Config; cwd: string }) {
  switch (it.kind) {
    case 'header':
      return (
        <Box paddingX={1} paddingTop={1}>
          <StaticLogo
            lines={[
              <Text color={C.gray}>orchestrator + parallel sub-agents</Text>,
              <Text color={C.dim}>{cwd}</Text>,
              <Text color={C.dim}>
                / commands · @ files · Tab completes · <Text color={C.orange}>/turbo</Text> full autonomy
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
