/**
 * Just brand marks (from justos.dev): the 13×13 app icon and the 7-row pixel alphabet
 * used by the JustOS wordmark. J, u, s, t, O, S are copied from the JustOS logo;
 * C, d, e and "-" are drawn in the same style.
 */

/** '#' = paper, 'O' = orange, '.' = ink. */
export const ICON = [
  '.............',
  '.............',
  '.............',
  '..#####.OOO..',
  '.....#..OOO..',
  '.....#..OOO..',
  '.....#..OOO..',
  '.....#..OOO..',
  '..#..#..OOO..',
  '...##...OOO..',
  '.............',
  '.............',
  '.............',
];

export const GLYPHS: Record<string, string[]> = {
  J: ['#####', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  u: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  s: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  t: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  d: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  e: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  '-': ['...', '...', '...', '###', '...', '...', '...'],
};

export const WORD = 'Just-Code';
export const CURSOR_WIDTH = 4;

/** Builds the wordmark as 7 rows; the orange cursor is marked with 'O'. */
export function wordmarkRows(word = WORD, cursor = true): string[] {
  const rows = Array.from({ length: 7 }, () => '');
  [...word].forEach((ch, i) => {
    const g = GLYPHS[ch === 'o' ? 'O' : ch];
    if (!g) throw new Error(`no glyph for ${ch}`);
    for (let y = 0; y < 7; y++) rows[y] += (i ? '.' : '') + g[y];
  });
  if (cursor) for (let y = 0; y < 7; y++) rows[y] += '..' + 'O'.repeat(CURSOR_WIDTH);
  return rows;
}
