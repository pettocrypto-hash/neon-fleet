import { BALANCE, type GameMode } from '../config/balance';
import { hashInts } from './rng';
import type { EventId } from './types';

export const EVENTS: EventId[] = ['storm', 'boost', 'blackout', 'overcharge'];

/** Deterministisches Event für eine Runde – für beide Spieler identisch. */
export function eventForRound(seed: number, round: number, mode: GameMode): EventId | null {
  if (mode !== 'cyber') return null;
  const every = BALANCE.events.everyRounds;
  if (every <= 0 || round <= 0 || round % every !== 0) return null;
  return EVENTS[hashInts(seed, round, 0xe7e) % EVENTS.length];
}
