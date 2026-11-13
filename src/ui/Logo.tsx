import React from 'react';
import { Box, Text } from 'ink';
import { C } from './theme.js';
import { useTick } from './hooks.js';
import { ICON, wordmarkRows } from './brand.js';

type Px = string | null; // colour or transparent

/**
 * Renders a pixel grid with half blocks: each terminal cell shows two vertical pixels,
 * so pixels come out (roughly) square.
 */
function PixelGrid({ grid }: { grid: Px[][] }) {
  const lines: React.ReactNode[] = [];
  for (let y = 0; y < grid.length; y += 2) {
    const top = grid[y];
    const bottom = grid[y + 1] ?? top.map(() => null);
    lines.push(
      <Text key={y}>
        {top.map((t, x) => {
          const b = bottom[x];
          if (!t && !b) return <Text key={x}> </Text>;
          if (t && !b) return <Text key={x} color={t}>▀</Text>;
          if (!t && b) return <Text key={x} color={b}>▄</Text>;
          return (
            <Text key={x} color={t!} backgroundColor={b!}>
              ▀
            </Text>
          );
        })}
      </Text>,
    );
  }
  return <Box flexDirection="column" flexShrink={0}>{lines}</Box>;
}

const colorOf = (ch: string, ink: Px): Px => (ch === '#' ? C.white : ch === 'O' ? C.orange : ink);

/** The 13×13 Just app icon. `reveal` draws it diagonally (pixels with x+y <= reveal). */
export function Icon({ reveal = Infinity }: { reveal?: number }) {
  const grid = ICON.map((row, y) =>
    [...row].map((ch, x) => (x + y <= reveal ? colorOf(ch, C.black) : C.black)),
  );
  return <PixelGrid grid={grid} />;
}

/** "Just-Code" in the JustOS pixel alphabet, with the blinking orange cursor. */
export function Wordmark({ reveal = Infinity, cursorOn = true }: { reveal?: number; cursorOn?: boolean }) {
  const rows = wordmarkRows();
  const grid = rows.map((row) =>
    [...row].map((ch, x) => {
      if (x > reveal) return null;
      if (ch === 'O') return cursorOn ? C.orange : null;
      return ch === '#' ? C.white : null;
    }),
  );
  return <PixelGrid grid={grid} />;
}

/** Animated splash: icon and wordmark draw themselves, then the cursor blinks. */
export function AnimatedLogo({ subtitle }: { subtitle: string }) {
  const tick = useTick(40);
  const cursorOn = Math.floor(tick / 12) % 2 === 0;
  return (
    <Box flexDirection="row" gap={3} alignItems="center">
      <Icon reveal={tick} />
      <Box flexDirection="column" gap={1}>
        <Wordmark reveal={tick * 2 - 10} cursorOn={cursorOn} />
        <Text color={C.gray}>{subtitle.slice(0, Math.max(0, (tick - 20) * 3))}</Text>
      </Box>
    </Box>
  );
}

/** Static header used in the scrollback. */
export function StaticLogo({ lines }: { lines: React.ReactNode[] }) {
  return (
    <Box flexDirection="row" gap={3} alignItems="center" marginBottom={1}>
      <Icon />
      <Box flexDirection="column">
        <Wordmark />
        <Box marginTop={1} flexDirection="column">
          {lines.map((l, i) => (
            <Box key={i}>{l}</Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}
