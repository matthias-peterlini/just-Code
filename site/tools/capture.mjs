// Usage (from repo root, after npm run build): COLORTERM=truecolor FORCE_COLOR=3 node site/tools/capture.mjs && python3 site/tools/build.py
// Captures real just-Code UI frames (Ink components from dist/) as ANSI strings.
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
const R = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const React = (await import(R + '/node_modules/react/index.js')).default;
const { render, Box } = await import(R + '/node_modules/ink/build/index.js');
const { AgentPanel } = await import(R + '/dist/ui/AgentPanel.js');
const { PermissionPrompt } = await import(R + '/dist/ui/Permission.js');
const { TurboBurst } = await import(R + '/dist/ui/Turbo.js');
const { ItemView } = await import(R + '/dist/ui/App.js');
const { defaultConfig } = await import(R + '/dist/config.js');
const h = React.createElement;
const cfg = defaultConfig();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mkOut(cols) {
  const o = new EventEmitter(); o.columns = cols; o.rows = 80; o.last = '';
  o.write = (s) => { if (s.trim()) o.last = s; return true; }; return o;
}
const stdin = new EventEmitter(); Object.assign(stdin, { isTTY: true, setRawMode() {}, setEncoding() {}, ref() {}, unref() {}, read: () => null });

const COLS = 76;
const item = (it, i) => h(ItemView, { key: i, it: { id: i, ...it }, config: cfg, cwd: '~/progetti/agenda' });

// ---------- session ----------
const prompt = 'la data di scadenza esce sbagliata di un giorno: trova il bug, aggiungi i test e aggiorna il README';
const plan = 'Il problema è probabilmente nel parsing delle date in UTC. Divido il lavoro in 4 compiti.';
const t0 = Date.now();
const A = (id, name, model, status, activity, tools, startOff, endOff) => ({ id, name, task: '', model, status, activity, tools, start: t0 + startOff, end: endOff == null ? undefined : t0 + endOff });
function agentsAt(ms) {
  const s = (startAt, endAt, acts, i, name, model) => {
    if (ms < startAt) return A(i, name, model, 'queued', acts[0], 0, ms, null);
    if (ms >= endAt) return A(i, name, model, 'done', acts[acts.length - 1], acts.length - 1, startAt, endAt);
    const k = Math.min(acts.length - 2, Math.floor(((ms - startAt) / (endAt - startAt)) * (acts.length - 1)));
    return A(i, name, model, 'running', acts[k], k, startAt, null);
  };
  return [
    s(0, 2600, ['search /new Date\\(/', 'read_file src/lib/date.ts', 'read_file src/views/Task.tsx', 'Il bug è in parseDue(): new Date("2026-11-12") è UTC'], 'a1', 'explorer', 'gemini:gemini-2.5-flash'),
    s(300, 4300, ['read_file src/lib/date.ts', 'edit_file src/lib/date.ts', 'run_shell npx tsc --noEmit', 'parseDue usa ora la data locale; tsc ok'], 'a2', 'bug-fixer', 'groq:llama-3.3-70b-versatile'),
    s(500, 5200, ['list_files tests/', 'write_file tests/date.test.ts', 'run_shell npm test', '6 test nuovi in tests/date.test.ts, npm test ok'], 'a3', 'test-writer', 'gemini:gemini-2.5-flash'),
    s(2600, 4600, ['read_file README.md', 'edit_file README.md', 'README: sezione "Date e fusi orari"'], 'a4', 'docs', 'openrouter:deepseek/deepseek-chat'),
  ];
}
const sessionFrames = [];
{
  const out = mkOut(COLS);
  const view = (ms, phase) => {
    const kids = [item({ kind: 'user', text: prompt }, 1)];
    if (phase === 'think') kids.push(h(AgentPanel, { key: 'p', agents: [], orchStatus: 'thinking…', model: 'gemini:gemini-2.5-pro' }));
    if (phase === 'run') {
      kids.push(item({ kind: 'assistant', text: plan }, 2));
      const ag = agentsAt(ms);
      const done = ag.every((a) => a.status === 'done');
      kids.push(h(AgentPanel, { key: 'p', agents: ag, orchStatus: done ? 'reviewing reports…' : 'delegating to 4 agents…', model: 'gemini:gemini-2.5-pro' }));
    }
    if (phase === 'end') {
      kids.push(item({ kind: 'assistant', text: plan }, 2));
      kids.push(item({ kind: 'agents', agents: agentsAt(99999) }, 3));
      kids.push(item({ kind: 'assistant', text: 'Fatto.\n- **Bug**: `parseDue()` interpretava "AAAA-MM-GG" come UTC; ora usa la data locale (`src/lib/date.ts`).\n- **Test**: 6 casi in `tests/date.test.ts`, `npm test` passa.\n- **README**: nuova sezione "Date e fusi orari".' }, 4));
    }
    return h(Box, { flexDirection: 'column', width: COLS }, ...kids);
  };
  const inst = render(view(0, 'think'), { stdout: out, stdin, debug: true, patchConsole: false, exitOnCtrlC: false });
  const grab = async (n, hold) => { for (let i = 0; i < n; i++) { await sleep(110); sessionFrames.push({ a: out.last, d: 110 }); } if (hold) sessionFrames[sessionFrames.length - 1].d = hold; };
  await grab(8);
  for (let ms = 0; ms <= 6000; ms += 110) { inst.rerender(view(ms, 'run')); await sleep(110); sessionFrames.push({ a: out.last, d: 110 }); }
  inst.rerender(view(0, 'end')); await sleep(150); sessionFrames.push({ a: out.last, d: 6000 });
  inst.unmount();
}

// ---------- permission ----------
let permission;
{
  const out = mkOut(COLS);
  const inst = render(h(Box, { width: COLS }, h(PermissionPrompt, { req: { agent: 'test-writer', tool: 'run_shell', summary: '$ npm test' }, queued: 1, onAnswer() {} })), { stdout: out, stdin, debug: true, patchConsole: false, exitOnCtrlC: false });
  await sleep(150); permission = out.last; inst.unmount();
}
let permEdit;
{
  const out = mkOut(COLS);
  const inst = render(h(Box, { width: COLS }, h(PermissionPrompt, { req: { agent: 'bug-fixer', tool: 'edit_file', summary: 'Edit src/lib/date.ts', detail: '- const d = new Date(value);\n+ const [y, m, day] = value.split("-").map(Number);\n+ const d = new Date(y, m - 1, day);' }, queued: 0, onAnswer() {} })), { stdout: out, stdin, debug: true, patchConsole: false, exitOnCtrlC: false });
  await sleep(150); permEdit = out.last; inst.unmount();
}

// ---------- turbo ----------
const turboFrames = [];
{
  const out = mkOut(COLS);
  const inst = render(h(Box, { width: COLS }, h(TurboBurst, { onDone() {} })), { stdout: out, stdin, debug: true, patchConsole: false, exitOnCtrlC: false });
  for (let i = 0; i < 46; i++) { await sleep(55); turboFrames.push({ a: out.last, d: 55 }); }
  inst.unmount();
}
fs.writeFileSync(new URL('frames.json', import.meta.url), JSON.stringify({ sessionFrames, permission, permEdit, turboFrames }));
console.log('session', sessionFrames.length, 'turbo', turboFrames.length);
process.exit(0);
