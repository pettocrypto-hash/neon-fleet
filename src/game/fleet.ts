import { BALANCE, SHIP_LENGTH } from '../config/balance';
import { areaCells, canPlace, idx, inBounds, N, sameCell, shipCells } from './board';
import type { ActionResult, Cell, Dir, Layout, ShipPlacement, ShotOutcome } from './types';

/**
 * Eigene Flotte eines Spielers (privat). Wird vom Verteidiger gehalten und löst
 * eingehende Angriffe auf. Reine Logik, keine UI.
 */
export interface ShipState extends ShipPlacement {
  hits: boolean[];
  shield: boolean;
  sunk: boolean;
}

export interface MineState extends Cell {
  triggered: boolean;
}

export interface FleetState {
  ships: ShipState[];
  mines: MineState[];
  hologram: Cell | null;
  /** Felder, die der Gegner beschossen hat. */
  shot: boolean[];
  /** Felder, von denen der Gegner weiß, dass dort ein Schiff liegt (Drohne, Schild). */
  known: boolean[];
  /** Felder, die der Gegner per Drohne aufgedeckt hat. */
  droned: boolean[];
}

export function createFleet(layout: Layout): FleetState {
  return {
    ships: layout.ships.map((s) => ({ ...s, hits: new Array(SHIP_LENGTH[s.kind]).fill(false), shield: false, sunk: false })),
    mines: layout.mines.map((m) => ({ ...m, triggered: false })),
    hologram: null,
    shot: new Array(N * N).fill(false),
    known: new Array(N * N).fill(false),
    droned: new Array(N * N).fill(false),
  };
}

export function cloneFleet(f: FleetState): FleetState {
  return JSON.parse(JSON.stringify(f));
}

export function shipAt(f: FleetState, c: Cell): { ship: ShipState; seg: number } | null {
  for (const ship of f.ships) {
    const cells = shipCells(ship);
    for (let i = 0; i < cells.length; i++) if (sameCell(cells[i], c)) return { ship, seg: i };
  }
  return null;
}

export const mineAt = (f: FleetState, c: Cell) => f.mines.find((m) => sameCell(m, c)) ?? null;
export const allSunk = (f: FleetState) => f.ships.every((s) => s.sunk);
const placement = (s: ShipState): ShipPlacement => ({ id: s.id, kind: s.kind, x: s.x, y: s.y, dir: s.dir });

/** Ein einzelner Schuss auf das eigene Feld. */
export function resolveShot(f: FleetState, c: Cell): ShotOutcome {
  if (!inBounds(c.x, c.y)) return { c, r: 'void' };
  const k = idx(c.x, c.y);
  if (f.shot[k]) return { c, r: 'void' };
  const hit = shipAt(f, c);
  if (hit && !hit.ship.sunk) {
    if (hit.ship.shield) {
      hit.ship.shield = false;
      f.known[k] = true;
      return { c, r: 'shield' };
    }
    f.shot[k] = true;
    hit.ship.hits[hit.seg] = true;
    if (hit.ship.hits.every(Boolean)) {
      hit.ship.sunk = true;
      return { c, r: 'sunk', ship: placement(hit.ship) };
    }
    return { c, r: 'hit' };
  }
  f.shot[k] = true;
  const mine = mineAt(f, c);
  if (mine) {
    mine.triggered = true;
    return { c, r: 'mine' };
  }
  if (f.hologram && sameCell(f.hologram, c)) return { c, r: 'hit' };
  return { c, r: 'miss' };
}

/** Anzahl intakter Schiffssegmente im Bereich (ohne Rauschen). */
export function radarCount(f: FleetState, c: Cell): number {
  let n = 0;
  for (const cell of areaCells(c, BALANCE.radarSize)) {
    const hit = shipAt(f, cell);
    if (hit && !hit.ship.sunk && !hit.ship.hits[hit.seg]) n++;
  }
  return n;
}

export function resolveDrone(f: FleetState, c: Cell): 'ship' | 'empty' {
  const k = idx(c.x, c.y);
  f.droned[k] = true;
  const hit = shipAt(f, c);
  // Minen und Hologramme bleiben für die Drohne unsichtbar.
  if (hit && !hit.ship.sunk && !hit.ship.hits[hit.seg]) {
    f.known[k] = true;
    return 'ship';
  }
  return 'empty';
}

export function resolveEmp(f: FleetState, c: Cell): number {
  const area = areaCells(c, BALANCE.empSize);
  let down = 0;
  for (const ship of f.ships) {
    if (ship.shield && shipCells(ship).some((sc) => area.some((a) => sameCell(a, sc)))) {
      ship.shield = false;
      down++;
    }
  }
  return down;
}

/** Löst einen gegnerischen Angriff vollständig auf (inkl. Rauschen beim Radar). */
export function resolveAttack(
  f: FleetState,
  action: { t: 'shot' | 'salvo' | 'radar' | 'drone' | 'emp'; c: Cell; dir?: Dir },
  cells: Cell[],
  radarNoise = 0,
): ActionResult {
  switch (action.t) {
    case 'shot':
    case 'salvo':
      return { t: 'shots', outcomes: cells.map((c) => resolveShot(f, c)) };
    case 'radar':
      return { t: 'radar', count: Math.max(0, radarCount(f, action.c) + radarNoise) };
    case 'drone':
      return { t: 'drone', r: resolveDrone(f, action.c) };
    case 'emp':
      return { t: 'emp', shieldsDown: resolveEmp(f, action.c) };
  }
}

// ---------- Eigene Spezialaktionen (Validierung + Anwendung) ----------

export function canShield(f: FleetState, shipId: number): boolean {
  const s = f.ships.find((sh) => sh.id === shipId);
  return !!s && !s.sunk && !s.shield;
}

export function applyShield(f: FleetState, shipId: number): boolean {
  if (!canShield(f, shipId)) return false;
  f.ships.find((sh) => sh.id === shipId)!.shield = true;
  return true;
}

export function canRepair(f: FleetState, c: Cell): boolean {
  const hit = shipAt(f, c);
  return !!hit && !hit.ship.sunk && hit.ship.hits[hit.seg];
}

export function applyRepair(f: FleetState, c: Cell): boolean {
  if (!canRepair(f, c)) return false;
  const hit = shipAt(f, c)!;
  hit.ship.hits[hit.seg] = false;
  const k = idx(c.x, c.y);
  f.shot[k] = false;
  f.known[k] = true; // Gegner sieht die Reparatur-Position
  return true;
}

export function canHologram(f: FleetState, c: Cell): boolean {
  if (!inBounds(c.x, c.y) || f.hologram) return false;
  const k = idx(c.x, c.y);
  return !f.shot[k] && !f.droned[k] && !shipAt(f, c) && !mineAt(f, c);
}

export function applyHologram(f: FleetState, c: Cell): boolean {
  if (!canHologram(f, c)) return false;
  f.hologram = { x: c.x, y: c.y };
  return true;
}

export function canJump(f: FleetState, shipId: number, x: number, y: number, dir: Dir): boolean {
  const s = f.ships.find((sh) => sh.id === shipId);
  if (!s || s.sunk || s.hits.some(Boolean)) return false;
  if (s.x === x && s.y === y && s.dir === dir) return false;
  const others = f.ships.filter((sh) => sh.id !== shipId);
  const p = { id: shipId, kind: s.kind, x, y, dir };
  if (!canPlace(others, f.mines, p)) return false;
  return shipCells(p).every((c) => {
    const k = idx(c.x, c.y);
    return !f.shot[k] && !f.droned[k] && !(f.hologram && sameCell(f.hologram, c));
  });
}

/** Teleportiert ein Schiff. Liefert die alten Felder, die dem Gegner bekannt waren. */
export function applyJump(f: FleetState, shipId: number, x: number, y: number, dir: Dir): Cell[] | null {
  if (!canJump(f, shipId, x, y, dir)) return null;
  const s = f.ships.find((sh) => sh.id === shipId)!;
  const cleared: Cell[] = [];
  for (const c of shipCells(s)) {
    const k = idx(c.x, c.y);
    if (f.known[k]) {
      f.known[k] = false;
      cleared.push(c);
    }
  }
  s.x = x;
  s.y = y;
  s.dir = dir;
  return cleared;
}

export function shipsInArea(f: FleetState, area: Cell[]): ShipState[] {
  return f.ships.filter((s) => shipCells(s).some((c) => area.some((a) => sameCell(a, c))));
}
