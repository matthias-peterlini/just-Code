import React from 'react';
import { Box, Text } from 'ink';
import { C, lerpColors } from './theme.js';
import { useTick } from './hooks.js';

/**
 * The Just logo as pixel art: black rounded tile, white pixel "J", orange cursor bar.
 * W = white, O = orange, . = black tile. Each pixel is two terminal cells wide.
 */
const PIXELS = [
  '............',
  '.WWWWW...OO.',
  '...W.....OO.',
  '...W.....OO.',
  '...W.....OO.',
  '...W.....OO.',
  '.W.W.....OO.',
  '..WW.....OO.',
  '............',
];
const W = PIXELS[0].length;
const H = PIXELS.length;

function Tile({ reveal, cursorOn }: { reveal: number; cursorOn: boolean }) {
  return (
    <Box flexDirection="column" flexShrink={0}>
      {PIXELS.map((row, y) => {
        const first = y === 0;
        const last = y === H - 1;
        return (
          <Text key={y}>
            {row.split('').map((ch, x) => {
              // Rounded corners: leave the 4 corner pixels transparent.
              if ((first || last) && (x === 0 || x === W - 1)) return <Text key={x}>{'  '}</Text>;
              const order = x + y; // diagonal reveal
              const shown = order <= reveal;
              let color = C.black;
              if (shown && ch === 'W') color = C.white;
              if (shown && ch === 'O') color = cursorOn ? C.orange : '#3A1A0E';
              return (
                <Text key={x} color={color}>
                  {'██'}
                </Text>
              );
            })}
          </Text>
        );
      })}
    </Box>
  );
}

export function Wordmark({ t }: { t: number }) {
  const word = 'just-Code';
  return (
    <Text bold>
      {word.split('').map((ch, i) => (
        <Text key={i} color={i < 4 ? C.white : lerpColors([C.orange, C.orangeSoft, '#FFD0A8', C.orangeSoft], t + i * 0.08)}>
          {ch}
        </Text>
      ))}
    </Text>
  );
}

/** Animated splash: tile draws itself diagonally, then the cursor blinks. */
export function AnimatedLogo({ subtitle }: { subtitle: string }) {
  const tick = useTick(45);
  const reveal = tick;
  const done = reveal > W + H;
  const cursorOn = !done || Math.floor(tick / 10) % 2 === 0;
  return (
    <Box flexDirection="row" gap={3} alignItems="center">
      <Tile reveal={reveal} cursorOn={cursorOn} />
      <Box flexDirection="column">
        <Wordmark t={tick / 40} />
        <Text color={C.gray}>{subtitle.slice(0, Math.max(0, (tick - 8) * 2))}</Text>
      </Box>
    </Box>
  );
}

/** Static small header used in the scrollback. */
export function StaticLogo({ lines }: { lines: React.ReactNode[] }) {
  return (
    <Box flexDirection="row" gap={3} alignItems="center" marginBottom={1}>
      <Tile reveal={999} cursorOn />
      <Box flexDirection="column">
        <Wordmark t={0} />
        {lines.map((l, i) => (
          <Box key={i}>{l}</Box>
        ))}
      </Box>
    </Box>
  );
}
