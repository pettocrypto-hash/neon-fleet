import { idx, N, shipCells } from './board';
import type { ActionResult, Cell, PublicAction, ShipPlacement } from './types';

/** Was ein Spieler über das gegnerische Feld weiß. */
export type ViewCell = 'unknown' | 'miss' | 'hit' | 'sunk' | 'mine' | 'ship' | 'empty';

export interface RadarMark extends Cell {
  count: number;
  round: number;
}

export interface EnemyView {
  cells: ViewCell[];
  sunk: ShipPlacement[];
  radar: RadarMark[];
}

export function createView(): EnemyView {
  return { cells: new Array(N * N).fill('unknown'), sunk: [], radar: [] };
}

export const viewAt = (v: EnemyView, c: Cell): ViewCell => v.cells[idx(c.x, c.y)];

/** Kann auf dieses Feld (sinnvoll) geschossen werden? */
export function isShootable(v: EnemyView, c: Cell): boolean {
  const s = viewAt(v, c);
  return s === 'unknown' || s === 'ship' || s === 'empty';
}

/** Überträgt das Ergebnis einer eigenen Aktion in die Sicht auf das gegnerische Feld. */
export function applyResultToView(v: EnemyView, action: PublicAction, result: ActionResult, round: number): void {
  if (result.t === 'shots') {
    for (const o of result.outcomes) {
      const k = idx(o.c.x, o.c.y);
      switch (o.r) {
        case 'miss':
          v.cells[k] = 'miss';
          break;
        case 'hit':
          v.cells[k] = 'hit';
          break;
        case 'mine':
          v.cells[k] = 'mine';
          break;
        case 'shield':
          v.cells[k] = 'ship';
          break;
        case 'sunk':
          if (o.ship) {
            v.sunk.push(o.ship);
            for (const c of shipCells(o.ship)) v.cells[idx(c.x, c.y)] = 'sunk';
          }
          break;
      }
    }
  } else if (result.t === 'radar' && 'c' in action) {
    v.radar = v.radar.filter((r) => !(r.x === action.c.x && r.y === action.c.y));
    v.radar.push({ ...action.c, count: result.count, round });
  } else if (result.t === 'drone' && action.t === 'drone') {
    const k = idx(action.c.x, action.c.y);
    if (v.cells[k] === 'unknown') v.cells[k] = result.r === 'ship' ? 'ship' : 'empty';
  }
}

/** Überträgt öffentliche Informationen einer gegnerischen Selbst-Aktion in meine Sicht. */
export function applyEnemySelfActionToView(v: EnemyView, action: PublicAction): void {
  if (action.t === 'repair') {
    const k = idx(action.c.x, action.c.y);
    if (v.cells[k] === 'hit') v.cells[k] = 'ship';
  } else if (action.t === 'jump') {
    for (const c of action.cleared) {
      const k = idx(c.x, c.y);
      if (v.cells[k] === 'ship') v.cells[k] = 'unknown';
    }
  }
}
