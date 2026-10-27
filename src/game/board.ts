import { BALANCE, BOARD_SIZE, FLEET, SHIP_LENGTH, type GameMode } from '../config/balance';
import { randInt } from './rng';
import type { Cell, Dir, Layout, ShipPlacement } from './types';

export const N = BOARD_SIZE;

export const idx = (x: number, y: number) => y * N + x;
export const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N;
export const sameCell = (a: Cell, b: Cell) => a.x === b.x && a.y === b.y;

export function shipCells(p: { kind: ShipPlacement['kind']; x: number; y: number; dir: Dir }): Cell[] {
  const len = SHIP_LENGTH[p.kind];
  const out: Cell[] = [];
  for (let i = 0; i < len; i++) out.push(p.dir === 'h' ? { x: p.x + i, y: p.y } : { x: p.x, y: p.y + i });
  return out;
}

/** 3×3 (oder size×size) Bereich um ein Zentrum, auf das Feld begrenzt. */
export function areaCells(c: Cell, size: number): Cell[] {
  const r = Math.floor(size / 2);
  const cx = Math.min(Math.max(c.x, r), N - 1 - r);
  const cy = Math.min(Math.max(c.y, r), N - 1 - r);
  const out: Cell[] = [];
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) out.push({ x, y });
  return out;
}

/** Salven-Felder: Zentrum c, Länge laut Balancing, auf das Feld begrenzt. */
export function salvoCells(c: Cell, dir: Dir, len: number = BALANCE.salvoLength): Cell[] {
  const r = Math.floor(len / 2);
  const out: Cell[] = [];
  if (dir === 'h') {
    const sx = Math.min(Math.max(c.x - r, 0), N - len);
    for (let i = 0; i < len; i++) out.push({ x: sx + i, y: c.y });
  } else {
    const sy = Math.min(Math.max(c.y - r, 0), N - len);
    for (let i = 0; i < len; i++) out.push({ x: c.x, y: sy + i });
  }
  return out;
}

export function fitsInBounds(p: { kind: ShipPlacement['kind']; x: number; y: number; dir: Dir }): boolean {
  return shipCells(p).every((c) => inBounds(c.x, c.y));
}

/** Prüft, ob ein Schiff an die Position passt (ohne Überlappung mit anderen Schiffen/Minen). */
export function canPlace(
  ships: ShipPlacement[],
  mines: Cell[],
  p: { id: number; kind: ShipPlacement['kind']; x: number; y: number; dir: Dir },
): boolean {
  if (!fitsInBounds(p)) return false;
  const occ = new Set<number>();
  for (const s of ships) if (s.id !== p.id) for (const c of shipCells(s)) occ.add(idx(c.x, c.y));
  for (const m of mines) occ.add(idx(m.x, m.y));
  return shipCells(p).every((c) => !occ.has(idx(c.x, c.y)));
}

export function minesForMode(mode: GameMode): number {
  return mode === 'cyber' ? BALANCE.mines.count : 0;
}

export function validateLayout(layout: Layout, mode: GameMode): string | null {
  if (layout.ships.length !== FLEET.length) return 'Falsche Flottengröße';
  const occ = new Set<number>();
  for (let i = 0; i < FLEET.length; i++) {
    const s = layout.ships.find((sh) => sh.id === i);
    if (!s) return `Schiff ${i} fehlt`;
    if (s.kind !== FLEET[i]) return `Schiff ${i} hat falschen Typ`;
    if (s.dir !== 'h' && s.dir !== 'v') return 'Ungültige Ausrichtung';
    for (const c of shipCells(s)) {
      if (!inBounds(c.x, c.y)) return 'Schiff außerhalb des Feldes';
      const k = idx(c.x, c.y);
      if (occ.has(k)) return 'Schiffe überlappen';
      occ.add(k);
    }
  }
  if (layout.mines.length !== minesForMode(mode)) return 'Falsche Minenanzahl';
  for (const m of layout.mines) {
    if (!inBounds(m.x, m.y)) return 'Mine außerhalb des Feldes';
    const k = idx(m.x, m.y);
    if (occ.has(k)) return 'Mine überlappt';
    occ.add(k);
  }
  return null;
}

export function randomShips(rng: () => number, existing: ShipPlacement[] = []): ShipPlacement[] {
  for (let attempt = 0; attempt < 200; attempt++) {
    const ships: ShipPlacement[] = [...existing];
    const missing = FLEET.map((kind, id) => ({ kind, id })).filter((s) => !ships.some((e) => e.id === s.id));
    missing.sort((a, b) => SHIP_LENGTH[b.kind] - SHIP_LENGTH[a.kind]);
    let ok = true;
    for (const { kind, id } of missing) {
      let placed = false;
      for (let t = 0; t < 400 && !placed; t++) {
        const dir: Dir = rng() < 0.5 ? 'h' : 'v';
        const p = { id, kind, x: randInt(rng, N), y: randInt(rng, N), dir };
        if (canPlace(ships, [], p)) {
          ships.push(p);
          placed = true;
        }
      }
      if (!placed) {
        ok = false;
        break;
      }
    }
    if (ok) return ships.sort((a, b) => a.id - b.id);
    existing = [];
  }
  throw new Error('Zufallsplatzierung fehlgeschlagen');
}

export function randomMines(rng: () => number, ships: ShipPlacement[], count: number, existing: Cell[] = []): Cell[] {
  const occ = new Set<number>();
  for (const s of ships) for (const c of shipCells(s)) occ.add(idx(c.x, c.y));
  const mines = [...existing];
  for (const m of mines) occ.add(idx(m.x, m.y));
  while (mines.length < count) {
    const c = { x: randInt(rng, N), y: randInt(rng, N) };
    if (occ.has(idx(c.x, c.y))) continue;
    occ.add(idx(c.x, c.y));
    mines.push(c);
  }
  return mines;
}

export function randomLayout(rng: () => number, mode: GameMode): Layout {
  const ships = randomShips(rng);
  return { ships, mines: randomMines(rng, ships, minesForMode(mode)) };
}

/** Kanonische Textform für das Commitment. */
export function canonicalLayout(layout: Layout): string {
  const ships = [...layout.ships]
    .sort((a, b) => a.id - b.id)
    .map((s) => `${s.id}:${s.kind}:${s.x},${s.y},${s.dir}`)
    .join(';');
  const mines = [...layout.mines]
    .sort((a, b) => idx(a.x, a.y) - idx(b.x, b.y))
    .map((m) => `${m.x},${m.y}`)
    .join(';');
  return `S[${ships}]M[${mines}]`;
}

export const COLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const cellName = (c: Cell) => `${COLS[c.x]}${c.y + 1}`;
