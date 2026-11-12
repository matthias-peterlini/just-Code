import React, { useEffect } from 'react';
import { Box, Text } from 'ink';
import { RAINBOW, lerpColors, C } from './theme.js';
import { useTick } from './hooks.js';

const FONT: Record<string, string[]> = {
  T: ['█████', '  █  ', '  █  ', '  █  ', '  █  '],
  U: ['█   █', '█   █', '█   █', '█   █', ' ███ '],
  R: ['████ ', '█   █', '████ ', '█  █ ', '█   █'],
  B: ['████ ', '█   █', '████ ', '█   █', '████ '],
  O: [' ███ ', '█   █', '█   █', '█   █', ' ███ '],
};
const WORD = 'TURBO';
const SPARKS = ['✦', '✧', '⋆', '·', '⚡', '✺', '*'];
const FLAMES = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

function rand(seed: number) {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

/** Colourful burst shown when turbo mode is switched on. Calls onDone after ~2.6s. */
export function TurboBurst({ onDone }: { onDone: () => void }) {
  const tick = useTick(50);
  useEffect(() => {
    const t = setTimeout(onDone, 2600);
    return () => clearTimeout(t);
  }, [onDone]);

  const width = WORD.length * 6 + 8;
  const sparkRow = (row: number) =>
    Array.from({ length: width }, (_, x) => {
      const r = rand(x * 31 + row * 7 + Math.floor(tick / 2) * 13);
      return r > 0.86 ? (
        <Text key={x} color={RAINBOW[Math.floor(r * 100) % RAINBOW.length]}>
          {SPARKS[Math.floor(r * 1000) % SPARKS.length]}
        </Text>
      ) : (
        <Text key={x}> </Text>
      );
    });

  const grow = Math.min(1, tick / 12); // letters slide in
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={lerpColors(RAINBOW, tick / 30)} paddingX={2} marginY={1}>
      <Text>{sparkRow(0)}</Text>
      {Array.from({ length: 5 }, (_, row) => (
        <Text key={row}>
          {'    '}
          {WORD.split('').map((ch, li) =>
            li / WORD.length <= grow ? (
              <Text key={li}>
                {FONT[ch][row].split('').map((px, i) => (
                  <Text key={i} color={lerpColors(RAINBOW, tick / 25 + (li * 6 + i) / 40 + row / 20)} bold>
                    {px}
                  </Text>
                ))}
                {' '}
              </Text>
            ) : (
              <Text key={li}>{'      '}</Text>
            ),
          )}
        </Text>
      ))}
      <Text>
        {Array.from({ length: width }, (_, x) => (
          <Text key={x} color={lerpColors([C.orange, '#FFD600', '#FF3B3B'], (x + tick) / 12)}>
            {FLAMES[Math.floor(rand(x * 17 + tick) * FLAMES.length)]}
          </Text>
        ))}
      </Text>
      <Text>{sparkRow(1)}</Text>
      <Text bold color={lerpColors(RAINBOW, tick / 15)}>
        {'   ⚡ TURBO MODE ON — agents act without asking ⚡'}
      </Text>
    </Box>
  );
}
