/** Brand palette taken from the Just logo. */
export const C = {
  black: '#111111',
  white: '#F5F5F5',
  orange: '#F2541B',
  orangeSoft: '#FF8A4C',
  gray: '#8A8A8A',
  dim: '#5A5A5A',
  green: '#4ADE80',
  red: '#F87171',
  yellow: '#FACC15',
  blue: '#7AA2F7',
};

export const RAINBOW = ['#FF3B3B', '#FF8A00', '#FFD600', '#3DFF6E', '#00E5FF', '#3D7BFF', '#B03DFF', '#FF3DCB'];

function hexToRgb(h: string) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r: number, g: number, b: number) {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

/** Interpolates along a list of colors, t in [0,1) (wraps). */
export function lerpColors(colors: string[], t: number): string {
  const x = (((t % 1) + 1) % 1) * colors.length;
  const i = Math.floor(x);
  const f = x - i;
  const a = hexToRgb(colors[i % colors.length]);
  const b = hexToRgb(colors[(i + 1) % colors.length]);
  return rgbToHex(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
}

export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
