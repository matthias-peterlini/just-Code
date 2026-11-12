import React from 'react';
import { Box, Text } from 'ink';
import { C } from './theme.js';

function Inline({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <Text>
      {parts.map((p, i) =>
        p.startsWith('`') && p.endsWith('`') ? (
          <Text key={i} color={C.orangeSoft}>
            {p.slice(1, -1)}
          </Text>
        ) : p.startsWith('**') && p.endsWith('**') ? (
          <Text key={i} bold>
            {p.slice(2, -2)}
          </Text>
        ) : (
          <Text key={i}>{p}</Text>
        ),
      )}
    </Text>
  );
}

/** Tiny terminal Markdown renderer: headings, lists, code fences, inline code, bold. */
export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const out: React.ReactNode[] = [];
  let code: string[] | null = null;
  let lang = '';
  lines.forEach((line, i) => {
    const fence = line.match(/^\s*```(\w*)/);
    if (fence) {
      if (code) {
        out.push(
          <Box key={i} flexDirection="column" borderStyle="single" borderColor={C.dim} paddingX={1}>
            {lang ? <Text color={C.dim}>{lang}</Text> : null}
            {code.map((l, j) => (
              <Text key={j} color="#C9D1D9">
                {l || ' '}
              </Text>
            ))}
          </Box>,
        );
        code = null;
      } else {
        code = [];
        lang = fence[1];
      }
      return;
    }
    if (code) {
      code.push(line);
      return;
    }
    const h = line.match(/^(#{1,6})\s+(.*)/);
    if (h) {
      out.push(
        <Text key={i} bold color={C.orange}>
          {h[2]}
        </Text>,
      );
      return;
    }
    const li = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)/);
    if (li) {
      out.push(
        <Text key={i}>
          {li[1]}
          <Text color={C.orange}>{/\d/.test(li[2]) ? li[2] : '•'} </Text>
          <Inline text={li[3]} />
        </Text>,
      );
      return;
    }
    out.push(<Inline key={i} text={line || ' '} />);
  });
  if (code) out.push(...(code as string[]).map((l, j) => <Text key={`c${j}`}>{l}</Text>));
  return <Box flexDirection="column">{out}</Box>;
}
