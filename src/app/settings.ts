import { BALANCE, type GameMode } from '../config/balance';
import type { Difficulty } from '../ai/ai';

export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  name: string;
  music: number;
  sfx: number;
  muted: boolean;
  quality: Quality;
  vibrate: boolean;
  turnSeconds: number;
  mode: GameMode;
  difficulty: Difficulty;
  lang: string;
}

const KEY = 'neonfleet.settings';

function defaults(): Settings {
  const lowEnd = typeof navigator !== 'undefined' && (navigator.hardwareConcurrency ?? 8) <= 4;
  return {
    name: 'Captain',
    music: 0.35,
    sfx: 0.6,
    muted: false,
    quality: lowEnd ? 'medium' : 'high',
    vibrate: true,
    turnSeconds: BALANCE.timers.turnSeconds,
    mode: 'cyber',
    difficulty: 'medium',
    lang: 'de',
  };
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaults(), ...JSON.parse(raw) };
  } catch {
    /* ignorieren */
  }
  return defaults();
}

export const settings: Settings = load();
const listeners = new Set<() => void>();

export function updateSettings(patch: Partial<Settings>) {
  Object.assign(settings, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* ignorieren */
  }
  for (const fn of listeners) fn();
}

export function onSettings(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function vibrate(pattern: number | number[]) {
  if (!settings.vibrate) return;
  // Ohne vorherige Nutzergeste blockiert der Browser die Vibration (und loggt Fehler).
  const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  if (ua && !ua.hasBeenActive) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* nicht unterstützt */
  }
}
