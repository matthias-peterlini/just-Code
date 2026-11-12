import React from 'react';
import { Box, Text } from 'ink';
import type { AgentStatus } from '../agents/orchestrator.js';
import { C, SPINNER, lerpColors } from './theme.js';
import { useTick } from './hooks.js';

export interface AgentView {
  id: string;
  name: string;
  task: string;
  model: string;
  status: AgentStatus;
  activity: string;
  tools: number;
  start: number;
  end?: number;
}

const secs = (a: AgentView) => (((a.end ?? Date.now()) - a.start) / 1000).toFixed(1) + 's';

function StatusIcon({ s, tick }: { s: AgentStatus; tick: number }) {
  if (s === 'done') return <Text color={C.green}>✔</Text>;
  if (s === 'error') return <Text color={C.red}>✘</Text>;
  if (s === 'queued') return <Text color={C.dim}>○</Text>;
  return <Text color={lerpColors([C.orange, C.orangeSoft, C.white], tick / 20)}>{SPINNER[tick % SPINNER.length]}</Text>;
}

/** Shimmering label: a highlight sweeps across the text. */
export function Shimmer({ text, tick, base = C.gray }: { text: string; tick: number; base?: string }) {
  const pos = tick % (text.length + 10);
  return (
    <Text>
      {text.split('').map((ch, i) => (
        <Text key={i} color={Math.abs(i - pos) < 3 ? C.white : base}>
          {ch}
        </Text>
      ))}
    </Text>
  );
}

export function AgentPanel({ agents, orchStatus, model }: { agents: AgentView[]; orchStatus: string; model: string }) {
  const tick = useTick(80);
  const done = agents.filter((a) => a.status === 'done' || a.status === 'error').length;
  const width = 24;
  const filled = agents.length ? Math.round((done / agents.length) * width) : 0;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={lerpColors([C.orange, '#5A2A12'], tick / 25)} paddingX={1}>
      <Text wrap="truncate-end">
        <Text color={C.orange}>{SPINNER[tick % SPINNER.length]} </Text>
        <Text bold>orchestrator </Text>
        <Text color={C.dim}>{model} </Text>
        <Shimmer text={orchStatus} tick={tick} />
      </Text>
      {agents.length > 0 && (
        <>
          <Text>
            <Text color={C.dim}>{'  sub-agents '}</Text>
            <Text color={C.orange}>{'█'.repeat(filled)}</Text>
            <Text color={C.dim}>{'░'.repeat(width - filled)}</Text>
            <Text color={C.gray}>{` ${done}/${agents.length}`}</Text>
          </Text>
          {agents.map((a, i) => (
            <Text key={a.id} wrap="truncate-end">
              <Text color={C.dim}>{i === agents.length - 1 ? '  └─ ' : '  ├─ '}</Text>
              <StatusIcon s={a.status} tick={tick + i * 3} />
              <Text bold color={a.status === 'error' ? C.red : C.white}>{` ${a.name}`}</Text>
              <Text color={C.dim}>{` ${a.model} · ${secs(a)} · ${a.tools} tools  `}</Text>
              <Text color={a.status === 'running' ? C.gray : C.dim}>{a.activity}</Text>
            </Text>
          ))}
        </>
      )}
      <Text color={C.dim}>{'  esc to interrupt'}</Text>
    </Box>
  );
}
