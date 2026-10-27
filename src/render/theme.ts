export const C = {
  bg: '#07020f',
  bg2: '#12062a',
  pink: '#ff2bd6',
  cyan: '#00f0ff',
  yellow: '#f9f871',
  green: '#39ff88',
  violet: '#9d4dff',
  orange: '#ff8a1f',
  red: '#ff3355',
  white: '#e9f6ff',
  grid: 'rgba(0, 240, 255, 0.16)',
  gridStrong: 'rgba(0, 240, 255, 0.42)',
};

export const FONT_DISPLAY = '"Orbitron", "Audiowide", system-ui, sans-serif';
export const FONT_UI = '"Rajdhani", system-ui, sans-serif';

/** Hex → rgba-String. */
export function rgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
