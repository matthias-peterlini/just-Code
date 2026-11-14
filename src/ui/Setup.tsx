import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { googleLogin } from '../auth/google.js';
import { googleOAuth, type Config } from '../config.js';
import { openBrowser } from '../core/open.js';
import { PRESETS, applySetup, defaultBaseUrl, testConnection, type Preset } from '../core/setup.js';
import { C, SPINNER } from './theme.js';
import { useTick } from './hooks.js';

interface Option {
  value: string;
  label: string;
  hint?: string;
  badge?: string;
}

/** Arrow-key list. */
function Select({ options, onPick, initial = 0 }: { options: Option[]; onPick: (v: string) => void; initial?: number }) {
  const [i, setI] = useState(initial);
  useInput((ch, key) => {
    if (key.upArrow) setI((x) => (x - 1 + options.length) % options.length);
    else if (key.downArrow) setI((x) => (x + 1) % options.length);
    else if (key.return) onPick(options[i].value);
    else if (/^[1-9]$/.test(ch) && Number(ch) <= options.length) onPick(options[Number(ch) - 1].value);
  });
  return (
    <Box flexDirection="column">
      {options.map((o, k) => (
        <Box key={o.value} flexDirection="column">
          <Text>
            <Text color={k === i ? C.orange : C.dim}>{k === i ? '❯ ' : '  '}</Text>
            <Text color={C.dim}>{k + 1}. </Text>
            <Text color={k === i ? C.white : C.gray} bold={k === i}>
              {o.label}
            </Text>
            {o.badge ? <Text color={C.green}>{`  ${o.badge}`}</Text> : null}
          </Text>
          {o.hint && k === i ? <Text color={C.dim}>{'      ' + o.hint}</Text> : null}
        </Box>
      ))}
    </Box>
  );
}

type Step = 'provider' | 'keypage' | 'key' | 'baseurl' | 'project' | 'login' | 'test' | 'orch' | 'orch-custom' | 'sub' | 'sub-custom' | 'mode' | 'done';

const STEP_NO: Partial<Record<Step, number>> = { provider: 1, keypage: 2, key: 2, baseurl: 2, project: 2, login: 2, test: 3, orch: 4, 'orch-custom': 4, sub: 4, 'sub-custom': 4, mode: 5, done: 6 };

/**
 * Guided setup: provider → credentials → connection test → models → permissions.
 * Esc goes back one step.
 */
export function Setup({ config, onDone, onCancel }: { config: Config; onDone: (c: Config) => void; onCancel?: () => void }) {
  const [step, setStep] = useState<Step>('provider');
  const [trail, setTrail] = useState<Step[]>([]);
  const [preset, setPreset] = useState<Preset>(PRESETS[0]);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [project, setProject] = useState(config.google.quotaProject ?? '');
  const [orch, setOrch] = useState('');
  const [sub, setSub] = useState('');
  const [text, setText] = useState('');
  const [testState, setTestState] = useState<{ running: boolean; ok?: boolean; error?: string }>({ running: false });
  const [loginMsg, setLoginMsg] = useState('');
  const [attempt, setAttempt] = useState(0);
  const tick = useTick(80, testState.running || step === 'login');

  const go = (s: Step, initialText = '') => {
    setTrail((t) => [...t, step]);
    setText(initialText);
    setStep(s);
  };
  const back = () => {
    if (!trail.length) return onCancel?.();
    const prev = trail[trail.length - 1];
    setStep(prev);
    setTrail((t) => t.slice(0, -1));
    setText(prev === 'baseurl' ? baseUrl : prev === 'project' ? project : '');
  };

  useInput((_ch, key) => {
    if (key.escape && step !== 'login' && !testState.running) back();
  });

  const draft = (o = orch || preset.orchestrator, s = sub || preset.sub, turbo = config.turbo) =>
    applySetup(config, { preset, apiKey: apiKey || undefined, baseUrl: baseUrl || undefined, project: project || undefined, orchestrator: o, sub: s, turbo });

  const afterCredentials = () => go('test');

  // connection test
  useEffect(() => {
    if (step !== 'test') return;
    let alive = true;
    setTestState({ running: true });
    const cfg = draft();
    void testConnection(cfg, cfg.orchestrator).then((r) => {
      if (alive) setTestState(r.ok ? { running: false, ok: true } : { running: false, ok: false, error: r.error });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, attempt]);

  // Google login
  useEffect(() => {
    if (step !== 'login') return;
    const ctrl = new AbortController();
    setLoginMsg('');
    googleLogin(googleOAuth(draft()), (url) => setLoginMsg(url), ctrl.signal)
      .then(() => go('test'))
      .catch((e) => {
        setLoginMsg('✘ ' + (e as Error).message);
        setTimeout(() => back(), 2500);
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const header = (
    <Box marginBottom={1} flexDirection="column">
      <Text>
        <Text color={C.orange} bold>
          ◆ just-Code setup
        </Text>
        <Text color={C.dim}>{`  step ${STEP_NO[step] ?? 1}/6  ·  Esc back`}</Text>
      </Text>
      <Text color={C.dim}>{'━'.repeat(Math.round(((STEP_NO[step] ?? 1) / 6) * 46)).padEnd(46, '─')}</Text>
    </Box>
  );

  let body: React.ReactNode = null;
  switch (step) {
    case 'provider':
      body = (
        <>
          <Text bold>Which AI provider do you want to use?</Text>
          <Text color={C.dim}>You can add more later with /key and mix models with /model.</Text>
          <Box marginTop={1}>
            <Select
              options={PRESETS.map((p) => ({ value: p.id, label: p.label, hint: p.hint, badge: p.free ? 'free' : undefined }))}
              onPick={(id) => {
                const p = PRESETS.find((x) => x.id === id)!;
                setPreset(p);
                setOrch('');
                setSub('');
                setApiKey(p.key !== 'none' ? (config.providers[p.provider]?.apiKey ?? '') : '');
                if (p.login) go('project', project);
                else if (p.baseUrl) go('baseurl', config.providers[p.provider]?.baseUrl ?? defaultBaseUrl(p.provider)); else go(p.keyUrl ? 'keypage' : 'key');
              }}
            />
          </Box>
        </>
      );
      break;
    case 'keypage':
      body = (
        <>
          <Text bold>{`You need an API key for ${preset.label.split(' —')[0]}.`}</Text>
          <Text color={C.gray}>
            Create it at <Text color={C.blue}>{preset.keyUrl}</Text>
          </Text>
          <Box marginTop={1}>
            <Select
              options={[
                { value: 'open', label: 'Open the page in the browser, then paste the key' },
                { value: 'have', label: apiKey ? 'Keep the key I already saved' : 'I already have a key — paste it' },
              ]}
              onPick={(v) => {
                if (v === 'open') void openBrowser(preset.keyUrl!);
                if (v === 'have' && apiKey) afterCredentials();
                else go('key');
              }}
            />
          </Box>
        </>
      );
      break;
    case 'key':
      body = (
        <>
          <Text bold>{`Paste your ${preset.provider} API key`}</Text>
          <Text color={C.dim}>{preset.key === 'optional' ? 'Optional for local servers — press Enter to skip.' : 'It is saved only on this computer, in ~/.just-code/config.json.'}</Text>
          <Box marginTop={1} borderStyle="round" borderColor={C.dim} paddingX={1}>
            <Text color={C.orange}>{'🔑 '}</Text>
            <TextInput
              value={text}
              onChange={setText}
              mask="•"
              onSubmit={(v) => {
                const k = v.trim();
                if (!k && preset.key === 'required') return;
                setApiKey(k);
                afterCredentials();
              }}
            />
          </Box>
        </>
      );
      break;
    case 'baseurl':
      body = (
        <>
          <Text bold>Endpoint URL (OpenAI-compatible)</Text>
          <Text color={C.dim}>Ollama: http://localhost:11434/v1 · LM Studio: http://localhost:1234/v1 — Enter to accept.</Text>
          <Box marginTop={1} borderStyle="round" borderColor={C.dim} paddingX={1}>
            <TextInput
              value={text}
              onChange={setText}
              onSubmit={(v) => {
                if (!v.trim()) return;
                setBaseUrl(v.trim());
                go('key');
              }}
            />
          </Box>
        </>
      );
      break;
    case 'project':
      body = (
        <>
          <Text bold>Your Google Cloud project ID</Text>
          <Text color={C.dim}>Usage is billed to this project; it needs the “Generative Language API” enabled.</Text>
          <Text color={C.dim}>Find it at https://console.cloud.google.com (project picker).</Text>
          <Box marginTop={1} borderStyle="round" borderColor={C.dim} paddingX={1}>
            <TextInput
              value={text}
              onChange={setText}
              placeholder="my-project-123"
              onSubmit={(v) => {
                const p = v.trim();
                if (!p) return;
                setProject(p);
                go('login');
              }}
            />
          </Box>
        </>
      );
      break;
    case 'login':
      body = (
        <>
          <Text>
            <Text color={C.orange}>{SPINNER[tick % SPINNER.length]} </Text>
            <Text bold>Sign in with Google in the browser…</Text>
          </Text>
          {loginMsg.startsWith('✘') ? (
            <Text color={C.red}>{loginMsg}</Text>
          ) : loginMsg ? (
            <Text color={C.dim}>
              If the browser did not open, visit:{'\n'}
              <Text color={C.blue}>{loginMsg}</Text>
            </Text>
          ) : null}
        </>
      );
      break;
    case 'test':
      body = testState.running ? (
        <Text>
          <Text color={C.orange}>{SPINNER[tick % SPINNER.length]} </Text>
          Testing <Text bold>{`${preset.provider}:${orch || preset.orchestrator}`}</Text>…
        </Text>
      ) : testState.ok ? (
        <>
          <Text color={C.green} bold>
            ✔ Connected! The model answered.
          </Text>
          <Box marginTop={1}>
            <Select options={[{ value: 'next', label: 'Continue' }]} onPick={() => go('orch')} />
          </Box>
        </>
      ) : (
        <>
          <Text color={C.red} bold>
            ✘ The test request failed
          </Text>
          <Text color={C.gray} wrap="wrap">
            {(testState.error ?? '').slice(0, 400)}
          </Text>
          <Box marginTop={1}>
            <Select
              options={[
                { value: 'retry', label: 'Try again' },
                ...(preset.key !== 'none' ? [{ value: 'key', label: 'Enter a different key' }] : []),
                { value: 'provider', label: 'Choose another provider' },
                { value: 'skip', label: 'Continue anyway', hint: 'e.g. the model name is different — you will pick it next' },
              ]}
              onPick={(v) => {
                if (v === 'retry') setAttempt((a) => a + 1);
                else if (v === 'key') go('key');
                else if (v === 'provider') {
                  setTrail([]);
                  setStep('provider');
                } else go('orch');
              }}
            />
          </Box>
        </>
      );
      break;
    case 'orch':
    case 'sub': {
      const isOrch = step === 'orch';
      const current = isOrch ? orch || preset.orchestrator : sub || preset.sub;
      const models = [...new Set([current, ...preset.models])];
      body = (
        <>
          <Text bold>{isOrch ? 'Model for the orchestrator' : 'Model for the sub-agents'}</Text>
          <Text color={C.dim}>
            {isOrch ? 'It plans the work and delegates: pick a strong model.' : 'They run many small tasks in parallel: a fast, cheap model is best.'}
          </Text>
          <Box marginTop={1}>
            <Select
              options={[
                ...models.map((m) => ({ value: m, label: m, badge: m === (isOrch ? preset.orchestrator : preset.sub) ? 'recommended' : undefined })),
                { value: '__other', label: 'Other… (type a model id)' },
              ]}
              onPick={(v) => {
                if (v === '__other') return go(isOrch ? 'orch-custom' : 'sub-custom');
                if (isOrch) {
                  setOrch(v);
                  go('sub');
                } else {
                  setSub(v);
                  go('mode');
                }
              }}
            />
          </Box>
        </>
      );
      break;
    }
    case 'orch-custom':
    case 'sub-custom':
      body = (
        <>
          <Text bold>Model id</Text>
          <Box marginTop={1} borderStyle="round" borderColor={C.dim} paddingX={1}>
            <TextInput
              value={text}
              onChange={setText}
              onSubmit={(v) => {
                const m = v.trim();
                if (!m) return;
                if (step === 'orch-custom') {
                  setOrch(m);
                  go('sub');
                } else {
                  setSub(m);
                  go('mode');
                }
              }}
            />
          </Box>
        </>
      );
      break;
    case 'mode':
      body = (
        <>
          <Text bold>How much freedom do the agents get?</Text>
          <Box marginTop={1}>
            <Select
              initial={config.turbo ? 1 : 0}
              options={[
                { value: 'ask', label: '🔒 Ask me before writing files or running commands', badge: 'recommended' },
                { value: 'turbo', label: '⚡ TURBO — do everything without asking', hint: 'Switch any time with /turbo' },
              ]}
              onPick={(v) => {
                const final = draft(orch || preset.orchestrator, sub || preset.sub, v === 'turbo');
                setStep('done');
                setTimeout(() => onDone(final), 0);
              }}
            />
          </Box>
        </>
      );
      break;
    case 'done':
      body = <Text color={C.green}>✔ Saved.</Text>;
      break;
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={C.orange} paddingX={2} paddingY={1}>
      {header}
      {body}
    </Box>
  );
}
