export type ThemeId = 'neon' | 'light';

interface Palette {
  bg: string;
  bg2: string;
  pink: string;
  cyan: string;
  yellow: string;
  green: string;
  violet: string;
  orange: string;
  red: string;
  white: string;
  grid: string;
  gridStrong: string;
  /** Mischmodus für Leuchteffekte: im Dunkeln additiv, im Hellen multiplizierend (weiße Glows verschwinden). */
  blend: GlobalCompositeOperation;
  panel0: string;
  panel1: string;
  hull: string;
  wreckHull: string;
  cockpit: string;
  badge: string;
}

const NEON: Palette = {
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
  blend: 'lighter',
  panel0: 'rgba(18, 6, 42, 0.88)',
  panel1: 'rgba(6, 2, 18, 0.92)',
  hull: 'rgba(6,14,30,0.92)',
  wreckHull: 'rgba(20,4,10,0.9)',
  cockpit: 'rgba(4,10,22,0.9)',
  badge: 'rgba(0,0,0,0.6)',
};

const LIGHT: Palette = {
  bg: '#f3f4f7',
  bg2: '#ffffff',
  pink: '#d6336c',
  cyan: '#1971c2',
  yellow: '#c27c0e',
  green: '#2f9e44',
  violet: '#6741d9',
  orange: '#e8590c',
  red: '#e03131',
  white: '#1f2430',
  grid: 'rgba(25, 113, 194, 0.16)',
  gridStrong: 'rgba(25, 113, 194, 0.42)',
  blend: 'multiply',
  panel0: 'rgba(255, 255, 255, 0.97)',
  panel1: 'rgba(240, 243, 248, 0.97)',
  hull: 'rgba(226,232,242,0.95)',
  wreckHull: 'rgba(214,206,206,0.9)',
  cockpit: 'rgba(250,251,253,0.95)',
  badge: 'rgba(255,255,255,0.9)',
};

export const C: Palette = { ...NEON };

/** Schaltet das Farbschema für Canvas (C) und CSS (data-theme) um. */
export function applyTheme(id: ThemeId) {
  Object.assign(C, id === 'light' ? LIGHT : NEON);
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', C.bg);
}

export const FONT_DISPLAY = '"Orbitron", "Audiowide", system-ui, sans-serif';
export const FONT_UI = '"Rajdhani", system-ui, sans-serif';

/** Hex → rgba-String. */
export function rgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
