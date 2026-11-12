import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { PermissionRequest } from '../tools/index.js';
import { C } from './theme.js';

export type PermissionAnswer = 'yes' | 'always' | 'no' | 'turbo';

export function PermissionPrompt({ req, queued, onAnswer }: { req: PermissionRequest; queued: number; onAnswer: (a: PermissionAnswer) => void }) {
  useInput((input, key) => {
    const k = input.toLowerCase();
    if (k === 'y' || key.return) onAnswer('yes');
    else if (k === 'a') onAnswer('always');
    else if (k === 'n' || key.escape) onAnswer('no');
    else if (k === 't') onAnswer('turbo');
  });
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={C.yellow} paddingX={1}>
      <Text>
        <Text color={C.yellow} bold>
          ? Permission{' '}
        </Text>
        <Text color={C.gray}>agent </Text>
        <Text bold>{req.agent}</Text>
        <Text color={C.gray}> wants to </Text>
        <Text bold color={C.orange}>
          {req.tool}
        </Text>
        {queued > 0 ? <Text color={C.dim}>{`  (+${queued} waiting)`}</Text> : null}
      </Text>
      <Text>{req.summary}</Text>
      {req.detail ? (
        <Box borderStyle="single" borderColor={C.dim} paddingX={1} flexDirection="column">
          {req.detail.split('\n').map((l, i) => (
            <Text key={i} color={l.startsWith('+') ? C.green : l.startsWith('-') ? C.red : C.gray} wrap="truncate-end">
              {l}
            </Text>
          ))}
        </Box>
      ) : null}
      <Text>
        <Text color={C.green}>[y]</Text> yes <Text color={C.blue}>[a]</Text> always for {req.tool} <Text color={C.red}>[n]</Text> no{' '}
        <Text color={C.orange} bold>
          [t] TURBO ⚡
        </Text>
      </Text>
    </Box>
  );
}
