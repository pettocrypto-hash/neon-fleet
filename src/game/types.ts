import type { ShipKind, SpecialId, GameMode } from '../config/balance';

export interface Cell {
  x: number;
  y: number;
}

export type Dir = 'h' | 'v';
/** 0 = Host (Spieler 1), 1 = Gast (Spieler 2). Im KI-Modus ist der Mensch 0. */
export type PlayerId = 0 | 1;

export interface ShipPlacement {
  id: number;
  kind: ShipKind;
  x: number;
  y: number;
  dir: Dir;
}

export interface Layout {
  ships: ShipPlacement[];
  mines: Cell[];
}

/** Ergebnis eines einzelnen Schusses auf ein Feld. */
export type ShotResultKind = 'miss' | 'hit' | 'sunk' | 'mine' | 'shield' | 'void';

export interface ShotOutcome {
  c: Cell;
  r: ShotResultKind;
  /** Bei 'sunk': das versenkte Schiff (wird dem Angreifer aufgedeckt). */
  ship?: ShipPlacement;
}

/** Aktion, wie sie über das Netz geht (nur öffentliche Informationen). */
export type PublicAction =
  | { t: 'shot'; c: Cell }
  | { t: 'salvo'; c: Cell; dir: Dir }
  | { t: 'radar'; c: Cell }
  | { t: 'drone'; c: Cell }
  | { t: 'emp'; c: Cell }
  | { t: 'shield' }
  | { t: 'repair'; c: Cell }
  | { t: 'hologram' }
  | { t: 'jump'; cleared: Cell[] };

export type ActionResult =
  | { t: 'shots'; outcomes: ShotOutcome[] }
  | { t: 'radar'; count: number }
  | { t: 'drone'; r: 'ship' | 'empty' }
  | { t: 'emp'; shieldsDown: number }
  | { t: 'ack' };

/** Private Details eigener Aktionen – werden erst am Spielende aufgedeckt. */
export type PrivateDetail =
  | { seq: number; t: 'shield'; shipId: number }
  | { seq: number; t: 'hologram'; c: Cell }
  | { seq: number; t: 'jump'; shipId: number; x: number; y: number; dir: Dir };

export interface LogEntry {
  seq: number;
  actor: PlayerId;
  round: number;
  storm: boolean;
  action: PublicAction;
  result: ActionResult;
}

export type EventId = 'storm' | 'boost' | 'blackout' | 'overcharge';

export interface PlayerStats {
  shots: number;
  hits: number;
  misses: number;
  minesHit: number;
  sunk: number;
  specials: number;
}

export interface MatchState {
  mode: GameMode;
  seed: number;
  starter: PlayerId;
  active: PlayerId;
  round: number;
  turn: number;
  energy: [number, number];
  combo: [number, number];
  shotsLeft: number;
  specialsLeft: number;
  empBlocked: [boolean, boolean];
  event: EventId | null;
  used: [Partial<Record<SpecialId, number>>, Partial<Record<SpecialId, number>>];
  stats: [PlayerStats, PlayerStats];
  winner: PlayerId | null;
  /** Letzte Combo-Auslösung (für UI). */
  lastComboTurn: number;
}

export type { ShipKind, SpecialId, GameMode };
