'use strict';
/* just-Code GUI — talks to the local just-Code server (same orchestrator as the terminal UI). */

const TOKEN = location.hash.slice(1);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const api = async (path, body) => {
  const r = await fetch('/api/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-jc-token': TOKEN, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return r.json();
};

const S = { config: {}, presets: [], commands: [], busy: false, perms: [], tokens: { input: 0, output: 0 }, history: [], histPos: -1 };

/* ---------- markdown (escaped first, so model output can never inject HTML) ---------- */
function inline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
function md(text) {
  const out = [];
  const parts = String(text).split(/```/);
  parts.forEach((part, i) => {
    if (i % 2) {
      const code = part.replace(/^[^\n]*\n/, '');
      out.push(`<pre><code>${esc(code.replace(/\n$/, ''))}</code></pre>`);
      return;
    }
    let list = null;
    const flush = () => {
      if (list) out.push(`<${list.t}>${list.items.map((x) => `<li>${x}</li>`).join('')}</${list.t}>`);
      list = null;
    };
    for (const raw of esc(part).split('\n')) {
      const line = raw.trimEnd();
      let m;
      if ((m = /^\s*[-*] (.*)/.exec(line))) {
        if (!list || list.t !== 'ul') { flush(); list = { t: 'ul', items: [] }; }
        list.items.push(inline(m[1]));
      } else if ((m = /^\s*\d+[.)] (.*)/.exec(line))) {
        if (!list || list.t !== 'ol') { flush(); list = { t: 'ol', items: [] }; }
        list.items.push(inline(m[1]));
      } else {
        flush();
        if ((m = /^(#{1,3}) (.*)/.exec(line))) out.push(`<h3>${inline(m[2])}</h3>`);
        else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
      }
    }
    flush();
  });
  return out.join('');
}

/* ---------- transcript ---------- */
const GUT = { user: '❯', assistant: '●', tool: '└', info: '·', agents: '└' };
function linkify(s) {
  return esc(s).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
}
function renderItem(it) {
  const el = document.createElement('div');
  el.className = `item ${it.kind} ${it.tone || ''}`;
  let body = '';
  if (it.kind === 'user') body = esc(it.text).replace(/(^|\s)@(\S+)/g, '$1<span class="o">@$2</span>');
  else if (it.kind === 'assistant') body = `<div class="md">${md(it.text)}</div>`;
  else if (it.kind === 'tool') body = `<b>${esc(it.name)}</b> ${esc(it.summary)}`;
  else if (it.kind === 'info') body = linkify(it.text);
  else if (it.kind === 'agents')
    body =
      `<div class="summary"><div class="muted">${it.agents.length} sub-agents</div>` +
      it.agents
        .map(
          (a) =>
            `<div><span class="${a.status === 'done' ? 'ok' : 'err'}">${a.status === 'done' ? '✔' : '✘'}</span><b>${esc(a.name)}</b>` +
            `<span class="muted">${esc(a.model)} · ${(((a.end || Date.now()) - a.start) / 1000).toFixed(1)}s · ${a.tools} tools</span></div>`,
        )
        .join('') +
      '</div>';
  el.innerHTML = `<span class="gut">${GUT[it.kind] || ''}</span><div class="body">${body}</div>`;
  return el;
}
function addItem(it) {
  if (it.kind === 'user') $('empty').hidden = true;
  const chat = $('chat');
  const stick = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 80;
  $('items').appendChild(renderItem(it));
  if (stick || it.kind === 'user') chat.scrollTop = chat.scrollHeight;
}

/* ---------- agents panel ---------- */
function renderAgents(agents, status) {
  if (status !== undefined && S.busy) $('status').textContent = status || 'thinking…';
  $('agents').hidden = !agents.length;
  $('agentCount').textContent = agents.length ? `${agents.filter((a) => a.status === 'done').length}/${agents.length}` : '';
  $('agentList').innerHTML = agents
    .map(
      (a) =>
        `<div class="agent ${a.status}"><div class="ah"><span class="name">${esc(a.name)}</span><span class="meta">${a.tools} tools</span></div>` +
        `<div class="meta">${esc(a.model)}</div><div class="act" title="${esc(a.activity)}">${esc(a.activity)}</div><div class="bar"><span></span></div></div>`,
    )
    .join('');
}

/* ---------- status / config ---------- */
function setBusy(b, status) {
  S.busy = b;
  $('working').hidden = !b;
  if (b) $('status').textContent = status || 'thinking…';
  const send = $('send');
  send.textContent = b ? 'Stop' : 'Send';
  send.classList.toggle('stop', b);
}
function setConfig(c) {
  S.config = c;
  $('models').textContent = `⬢ ${c.orchestrator} → ${c.subagent} ×${c.maxParallel}`;
  $('turbo').checked = !!c.turbo;
  document.body.classList.toggle('turbo-on', !!c.turbo);
}

/* ---------- turbo burst ---------- */
function burst() {
  const b = $('burst');
  b.hidden = false;
  const colors = ['#FF3B3B', '#FF8A00', '#FFD600', '#3DFF6E', '#00E5FF', '#3D7BFF', '#B03DFF', '#FF3DCB'];
  for (let i = 0; i < 46; i++) {
    const s = document.createElement('span');
    s.className = 'spark';
    const ang = Math.random() * Math.PI * 2;
    const dist = 140 + Math.random() * Math.min(innerWidth, innerHeight) * 0.45;
    s.style.left = innerWidth / 2 + 'px';
    s.style.top = innerHeight / 2 + 'px';
    s.style.background = colors[i % colors.length];
    s.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
    s.style.setProperty('--dy', Math.sin(ang) * dist + 'px');
    s.style.animationDelay = Math.random() * 0.25 + 's';
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 1500);
  }
  setTimeout(() => (b.hidden = true), 1650);
}

/* ---------- permissions ---------- */
function showPerm() {
  const p = S.perms[0];
  $('perm').hidden = !p;
  if (!p) return;
  $('permAgent').textContent = p.req.agent;
  $('permTool').textContent = p.req.tool;
  $('permQueue').textContent = S.perms.length > 1 ? `(+${S.perms.length - 1} waiting)` : '';
  $('permSummary').textContent = p.req.summary;
  const d = $('permDetail');
  d.hidden = !p.req.detail;
  d.innerHTML = (p.req.detail || '')
    .split('\n')
    .map((l) => `<span class="${l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : ''}">${esc(l)}</span>`)
    .join('\n');
  document.querySelector('#perm .primary').focus();
}
function answerPerm(a) {
  const p = S.perms[0];
  if (p) api('permission', { id: p.id, answer: a });
}
document.querySelectorAll('#perm .actions button').forEach((b) => b.addEventListener('click', () => answerPerm(b.dataset.a)));

/* ---------- composer + autocomplete ---------- */
const input = $('input');
let sugg = [];
let sel = 0;
let picked = false;
let seq = 0;
const KIND = { command: '', arg: '›', file: '@', history: '↺', prompt: '✦' };

function autoSize() {
  input.style.height = 'auto';
  input.style.height = Math.min(200, input.scrollHeight) + 'px';
}
function showSuggest(list) {
  sugg = list;
  sel = 0;
  picked = false;
  const box = $('suggest');
  box.hidden = !list.length;
  box.innerHTML = list
    .map(
      (s, i) =>
        `<div class="sg ${s.kind}${i === 0 ? ' on' : ''}" data-i="${i}"><span class="k">${KIND[s.kind] || ''}</span>` +
        `<span class="l">${esc(s.label)}</span><span class="h">${esc(s.hint || '')}</span></div>`,
    )
    .join('');
}
function highlight() {
  document.querySelectorAll('.sg').forEach((el, i) => el.classList.toggle('on', i === sel));
  document.querySelector('.sg.on')?.scrollIntoView({ block: 'nearest' });
}
async function refreshSuggest() {
  const q = input.value;
  if (!q || q.includes('\n')) return showSuggest([]);
  const my = ++seq;
  const list = await api('complete?q=' + encodeURIComponent(q));
  if (my === seq && input.value === q) showSuggest(Array.isArray(list) ? list : []);
}
function accept(s) {
  if (!s) return;
  input.value = s.value;
  input.focus();
  input.setSelectionRange(s.value.length, s.value.length);
  autoSize();
  refreshSuggest();
}
$('suggest').addEventListener('mousedown', (e) => {
  const el = e.target.closest('.sg');
  if (!el) return;
  e.preventDefault();
  accept(sugg[Number(el.dataset.i)]);
});
input.addEventListener('input', () => {
  S.histPos = -1;
  autoSize();
  refreshSuggest();
});
input.addEventListener('keydown', (e) => {
  const open = !$('suggest').hidden && sugg.length;
  if (e.key === 'Tab' && open) {
    e.preventDefault();
    accept(sugg[sel]);
  } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && open) {
    e.preventDefault();
    sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + sugg.length) % sugg.length;
    picked = true;
    highlight();
  } else if (e.key === 'ArrowUp' && !open && !input.value.includes('\n') && S.history.length) {
    e.preventDefault();
    S.histPos = S.histPos < 0 ? S.history.length - 1 : Math.max(0, S.histPos - 1);
    input.value = S.history[S.histPos];
    autoSize();
  } else if (e.key === 'ArrowDown' && !open && S.histPos >= 0) {
    e.preventDefault();
    S.histPos++;
    input.value = S.histPos < S.history.length ? S.history[S.histPos] : '';
    if (S.histPos >= S.history.length) S.histPos = -1;
    autoSize();
  } else if (e.key === 'Escape') {
    if (open) showSuggest([]);
    else if (S.busy) api('interrupt', {});
  } else if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (open && picked) return accept(sugg[sel]);
    submit();
  }
});
function submit(text = input.value) {
  text = text.trim();
  if (!text) return;
  if (S.busy && !text.startsWith('/')) return;
  S.history = [...S.history.filter((h) => h !== text), text];
  S.histPos = -1;
  input.value = '';
  autoSize();
  showSuggest([]);
  api('send', { text });
}
$('send').addEventListener('click', () => (S.busy ? api('interrupt', {}) : submit()));
$('turbo').addEventListener('change', (e) => api('turbo', { on: e.target.checked }));
$('models').addEventListener('click', () => {
  input.value = '/model ';
  input.focus();
  refreshSuggest();
});
$('settings').addEventListener('click', () => openSetup());
document.addEventListener('keydown', (e) => {
  if (!$('perm').hidden && document.activeElement?.tagName !== 'INPUT') {
    const k = e.key.toLowerCase();
    const a = { y: 'yes', a: 'always', n: 'no', t: 'turbo', escape: 'no' }[k];
    if (a) {
      e.preventDefault();
      answerPerm(a);
    }
  }
});
input.addEventListener('blur', () => setTimeout(() => showSuggest([]), 150));

function renderStarters(list) {
  $('starters').innerHTML = (list || []).map((s, i) => `<button data-i="${i}">${esc(s)}</button>`).join('');
  $('starters').querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => {
      const s = list[Number(b.dataset.i)];
      if (s.endsWith(' ')) {
        input.value = s;
        input.focus();
        input.setSelectionRange(s.length, s.length);
      } else submit(s);
    }),
  );
}

/* ---------- guided setup ---------- */
const W = { step: 'provider', trail: [], preset: null, apiKey: '', baseUrl: '', project: '', orchestrator: '', sub: '', turbo: false };
const STEPS = { provider: 1, key: 2, baseurl: 2, project: 2, login: 2, test: 3, orch: 4, sub: 4, mode: 5 };
function openSetup() {
  Object.assign(W, { step: 'provider', trail: [], preset: null, apiKey: '', baseUrl: '', project: S.config.project || '', orchestrator: '', sub: '', turbo: !!S.config.turbo });
  $('setup').hidden = false;
  drawSetup();
}
function go(step) {
  W.trail.push(W.step);
  W.step = step;
  drawSetup();
}
function back() {
  if (!W.trail.length) return closeSetup();
  W.step = W.trail.pop();
  drawSetup();
}
function closeSetup() {
  $('setup').hidden = true;
  if (S.config.needsSetup) api('skip-setup', {}).then(setConfig);
  input.focus();
}
$('setupClose').addEventListener('click', closeSetup);
const draft = () => ({ preset: W.preset.id, apiKey: W.apiKey, baseUrl: W.baseUrl, project: W.project, orchestrator: W.orchestrator || W.preset.orchestrator, sub: W.sub || W.preset.sub, turbo: W.turbo });
const backBtn = () => `<button class="btn" data-act="back">← Back</button>`;

function drawSetup() {
  const p = W.preset;
  $('stepNo').textContent = `step ${STEPS[W.step]}/5`;
  $('progress').style.width = (STEPS[W.step] / 5) * 100 + '%';
  const B = $('setupBody');
  let h = '';
  switch (W.step) {
    case 'provider':
      h =
        `<p class="q2">Which AI provider do you want to use?</p><p class="sub">You can add more later with /key and mix models with /model.</p><div class="opts">` +
        S.presets
          .map(
            (x) =>
              `<button class="opt" data-preset="${x.id}"><span class="t">${esc(x.label)}</span>${x.free ? '<span class="badge">free</span>' : ''}` +
              `<span class="d">${esc(x.hint)}</span></button>`,
          )
          .join('') +
        '</div>';
      break;
    case 'key':
      h =
        `<p class="q2">API key for ${esc(p.label.split(' —')[0])}</p>` +
        `<p class="sub">${p.key === 'optional' ? 'Optional for local servers.' : 'Saved only on this computer (~/.just-code/config.json).'}</p>` +
        (p.keyUrl ? `<p class="sub">Create one at <a href="${esc(p.keyUrl)}" target="_blank" rel="noopener" class="o">${esc(p.keyUrl)}</a></p>` : '') +
        `<div class="field"><input id="f" type="password" autocomplete="off" placeholder="${S.config.keys?.[p.provider] ? 'leave empty to keep the saved key' : 'paste the key'}" value="${esc(W.apiKey)}"></div>` +
        `<div class="row">${backBtn()}<button class="btn primary" data-act="key">Test connection →</button></div>`;
      break;
    case 'baseurl':
      h =
        `<p class="q2">Endpoint URL (OpenAI-compatible)</p><p class="sub">Ollama: http://localhost:11434/v1 · LM Studio: http://localhost:1234/v1</p>` +
        `<div class="field"><input id="f" value="${esc(W.baseUrl || 'http://localhost:11434/v1')}"></div>` +
        `<div class="row">${backBtn()}<button class="btn primary" data-act="baseurl">Next →</button></div>`;
      break;
    case 'project':
      h =
        `<p class="q2">Your Google Cloud project ID</p><p class="sub">Usage is billed to this project; it needs the “Generative Language API” enabled. ` +
        `Find it at <a class="o" href="https://console.cloud.google.com" target="_blank" rel="noopener">console.cloud.google.com</a>.</p>` +
        `<div class="field"><input id="f" placeholder="my-project-123" value="${esc(W.project)}"></div>` +
        `<div class="row">${backBtn()}<button class="btn primary" data-act="project">Sign in with Google →</button></div>`;
      break;
    case 'login':
      h = `<p class="q2"><span class="spin" style="display:inline-block"></span>&nbsp; Sign in with Google in the browser…</p><p class="sub" id="loginUrl"></p><div class="row">${backBtn()}</div>`;
      break;
    case 'test':
      h = `<p class="q2"><span class="spin" style="display:inline-block"></span>&nbsp; Testing ${esc(p.provider)}:${esc(W.orchestrator || p.orchestrator)}…</p>`;
      break;
    case 'orch':
    case 'sub': {
      const isO = W.step === 'orch';
      const rec = isO ? p.orchestrator : p.sub;
      h =
        `<p class="q2">${isO ? 'Model for the orchestrator' : 'Model for the sub-agents'}</p>` +
        `<p class="sub">${isO ? 'It plans the work and delegates: pick a strong model.' : 'They run many small tasks in parallel: a fast, cheap model is best.'}</p><div class="opts">` +
        [...new Set([rec, ...p.models])].map((m) => `<button class="opt" data-model="${esc(m)}"><span class="t">${esc(m)}</span>${m === rec ? '<span class="badge">recommended</span>' : ''}</button>`).join('') +
        `</div><div class="field" style="margin-top:12px"><input id="f" placeholder="…or type another model id and press Enter"></div><div class="row">${backBtn()}</div>`;
      break;
    }
    case 'mode':
      h =
        `<p class="q2">How much freedom do the agents get?</p><div class="opts">` +
        `<button class="opt" data-mode="ask"><span class="t">🔒 Ask me before writing files or running commands</span><span class="badge">recommended</span></button>` +
        `<button class="opt" data-mode="turbo"><span class="t">⚡ TURBO — do everything without asking</span><span class="d">Switch any time with the TURBO toggle or /turbo</span></button>` +
        `</div><div class="row">${backBtn()}</div>`;
      break;
  }
  B.innerHTML = h;
  const f = $('f');
  if (f) {
    f.focus();
    f.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      if (W.step === 'orch' || W.step === 'sub') pickModel(f.value.trim());
      else B.querySelector('.btn.primary')?.click();
    });
  }
  B.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => pickPreset(b.dataset.preset)));
  B.querySelectorAll('[data-model]').forEach((b) => b.addEventListener('click', () => pickModel(b.dataset.model)));
  B.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => finish(b.dataset.mode === 'turbo')));
  B.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => act(b.dataset.act)));
  if (W.step === 'test') runTest();
  if (W.step === 'login') runLogin();
  B.querySelector('.opt')?.focus();
}
function pickPreset(id) {
  W.preset = S.presets.find((x) => x.id === id);
  W.apiKey = '';
  W.orchestrator = W.sub = '';
  if (W.preset.login) go('project');
  else if (W.preset.baseUrl) go('baseurl');
  else go('key');
}
function act(a) {
  const v = $('f')?.value.trim() ?? '';
  if (a === 'back') return back();
  if (a === 'key') {
    if (!v && W.preset.key === 'required' && !S.config.keys?.[W.preset.provider]) return $('f').focus();
    W.apiKey = v;
    go('test');
  }
  if (a === 'baseurl' && v) {
    W.baseUrl = v;
    go('key');
  }
  if (a === 'project' && v) {
    W.project = v;
    go('login');
  }
}
function pickModel(m) {
  if (!m) return;
  if (W.step === 'orch') {
    W.orchestrator = m;
    go('sub');
  } else {
    W.sub = m;
    go('mode');
  }
}
async function runTest() {
  const r = await api('test', draft());
  if (W.step !== 'test') return;
  const B = $('setupBody');
  if (r.ok) {
    B.innerHTML = `<p class="q2 ok">✔ Connected! The model answered.</p><div class="row">${backBtn()}<button class="btn primary" data-act2="next">Continue →</button></div>`;
  } else {
    B.innerHTML =
      `<p class="q2 err">✘ The test request failed</p><div class="errbox">${esc(String(r.error || '').slice(0, 600))}</div>` +
      `<div class="row">${backBtn()}<span><button class="btn" data-act2="retry">Try again</button> <button class="btn" data-act2="next">Continue anyway</button></span></div>`;
  }
  B.querySelector('[data-act="back"]').addEventListener('click', back);
  B.querySelectorAll('[data-act2]').forEach((b) =>
    b.addEventListener('click', () => (b.dataset.act2 === 'retry' ? drawSetup() : go('orch'))),
  );
  B.querySelector('.btn.primary, [data-act2="retry"]')?.focus();
}
async function runLogin() {
  const r = await api('login', draft());
  if (W.step !== 'login') return;
  if (r.ok) go('test');
  else $('setupBody').innerHTML = `<p class="q2 err">✘ ${esc(r.error)}</p><div class="row">${backBtn()}</div>`, $('setupBody').querySelector('[data-act]').addEventListener('click', back);
}
async function finish(turbo) {
  W.turbo = turbo;
  const c = await api('setup', draft());
  setConfig(c);
  $('setup').hidden = true;
  input.focus();
}
$('setup').addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && W.step !== 'test') back();
});

/* ---------- events ---------- */
function connect() {
  const es = new EventSource('/api/events?t=' + encodeURIComponent(TOKEN));
  es.addEventListener('hello', (e) => {
    const d = JSON.parse(e.data);
    S.presets = d.presets;
    S.commands = d.commands;
    $('cwd').textContent = d.cwd;
    document.title = 'just-Code — ' + d.cwd.split(/[\\/]/).pop();
    $('items').innerHTML = '';
    $('empty').hidden = d.items.some((i) => i.kind === 'user');
    d.items.forEach(addItem);
    renderStarters(d.starters);
    setConfig(d.config);
    setBusy(d.busy, d.status);
    renderAgents(d.agents, d.status);
    S.perms = d.pending;
    showPerm();
    if (d.config.needsSetup && $('setup').hidden) openSetup();
    api('history').then((h) => (S.history = Array.isArray(h) ? h : []));
  });
  es.addEventListener('item', (e) => addItem(JSON.parse(e.data)));
  es.addEventListener('busy', (e) => {
    const d = JSON.parse(e.data);
    setBusy(d.busy, d.status);
  });
  es.addEventListener('agents', (e) => {
    const d = JSON.parse(e.data);
    renderAgents(d.agents, d.status);
  });
  es.addEventListener('event', (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === 'usage') {
      S.tokens.input += ev.input;
      S.tokens.output += ev.output;
      $('tokens').textContent = `↑${S.tokens.input} ↓${S.tokens.output}`;
    }
  });
  es.addEventListener('config', (e) => setConfig(JSON.parse(e.data)));
  es.addEventListener('turbo', (e) => {
    if (JSON.parse(e.data).on) burst();
  });
  es.addEventListener('permission', (e) => {
    S.perms.push(JSON.parse(e.data));
    showPerm();
  });
  es.addEventListener('permission:done', (e) => {
    const { id } = JSON.parse(e.data);
    S.perms = S.perms.filter((p) => p.id !== id);
    showPerm();
  });
  es.addEventListener('setup', () => openSetup());
  es.addEventListener('login-url', (e) => {
    const el = $('loginUrl');
    const { url } = JSON.parse(e.data);
    if (el) el.innerHTML = `If the browser did not open, <a class="o" href="${esc(url)}" target="_blank" rel="noopener">click here</a>.`;
  });
  es.onerror = () => {
    $('status').textContent = 'reconnecting…';
  };
}

if (!TOKEN) document.body.innerHTML = '<p style="padding:24px">Open just-Code with <code>just-code gui</code>.</p>';
else connect();
input.focus();
