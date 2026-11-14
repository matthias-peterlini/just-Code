#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './ui/App.js';
import { createRequire } from 'node:module';
import { loadConfig, parseModelRef } from './config.js';

const VERSION: string = createRequire(import.meta.url)('../package.json').version;

const HELP = `just-Code — terminal AI IDE (orchestrator + parallel sub-agents)

Usage: just-code [options] [prompt]
       just-code gui [--port <n>] [--no-open]   graphical interface (opens an app window)
       just-code setup                         guided setup

Options:
  --turbo                     start in TURBO mode (no confirmations)
  --orchestrator <p:model>    e.g. gemini:gemini-2.5-pro
  --sub <p:model>             e.g. groq:llama-3.3-70b-versatile
  --parallel <n>              max sub-agents running at once
  -h, --help                  show this help
  -v, --version               show version

Inside the app type /help — Tab completes commands, @ completes file names.`;

const argv = process.argv.slice(2);
const cfg = loadConfig();
const rest: string[] = [];
let mode: 'tui' | 'gui' | 'setup' = 'tui';
let port: number | undefined;
let openWindow = true;
if (argv[0] === 'gui' || argv[0] === 'setup') mode = argv.shift() as 'gui' | 'setup';
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const next = () => argv[++i];
  if (a === '-h' || a === '--help') {
    console.log(HELP);
    process.exit(0);
  } else if (a === '-v' || a === '--version') {
    console.log(`just-Code ${VERSION}`);
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
  else if (a === '--gui') mode = 'gui';
  else if (a === '--port') port = Number(next()) || undefined;
  else if (a === '--no-open') openWindow = false;
  else rest.push(a);
}

if (mode === 'gui') {
  const { startGui } = await import('./gui/server.js');
  const { url } = await startGui({ cwd: process.cwd(), config: cfg, version: VERSION, port, open: openWindow });
  console.log(`just-Code ${VERSION} GUI running for ${process.cwd()}
  ${url}
(keep this terminal open — Ctrl+C to quit)`);
  process.on('SIGINT', () => process.exit(0));
  await new Promise(() => {});
}

if (!process.stdin.isTTY) {
  console.error('just-Code needs an interactive terminal (TTY).');
  if (process.platform === 'win32')
    console.error('On Windows use Windows Terminal, PowerShell or cmd. In Git Bash/MinTTY run: winpty just-code');
  process.exit(1);
}

const { waitUntilExit } = render(<App initialConfig={cfg} cwd={process.cwd()} initialPrompt={rest.join(' ') || undefined} forceSetup={mode === 'setup'} />, {
  exitOnCtrlC: false,
});
await waitUntilExit();
process.exit(0);
