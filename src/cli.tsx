#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './ui/App.js';
import { loadConfig, parseModelRef } from './config.js';

const HELP = `just-Code — terminal AI IDE (orchestrator + parallel sub-agents)

Usage: just-code [options] [prompt]

Options:
  --turbo                     start in TURBO mode (no confirmations)
  --orchestrator <p:model>    e.g. gemini:gemini-2.5-pro
  --sub <p:model>             e.g. groq:llama-3.3-70b-versatile
  --parallel <n>              max sub-agents running at once
  -h, --help                  show this help
  -v, --version               show version

Inside the app type /help. Sign in to Gemini with /login (Google account).`;

const argv = process.argv.slice(2);
const cfg = loadConfig();
const rest: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const next = () => argv[++i];
  if (a === '-h' || a === '--help') {
    console.log(HELP);
    process.exit(0);
  } else if (a === '-v' || a === '--version') {
    console.log('just-Code 0.1.0');
    process.exit(0);
  } else if (a === '--turbo') cfg.turbo = true;
  else if (a === '--orchestrator' || a === '--sub') {
    const ref = parseModelRef(next() ?? '');
    if (!ref) {
      console.error(`Invalid ${a} value; expected provider:model`);
      process.exit(1);
    }
    if (a === '--sub') cfg.subagent = ref;
    else cfg.orchestrator = ref;
  } else if (a === '--parallel') cfg.maxParallel = Math.max(1, Number(next()) || cfg.maxParallel);
  else rest.push(a);
}

if (!process.stdin.isTTY) {
  console.error('just-Code needs an interactive terminal (TTY).');
  process.exit(1);
}

const { waitUntilExit } = render(<App initialConfig={cfg} cwd={process.cwd()} initialPrompt={rest.join(' ') || undefined} />, {
  exitOnCtrlC: false,
});
await waitUntilExit();
process.exit(0);
