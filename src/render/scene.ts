import { idx, N, shipCells } from '../game/board';
import type { FleetState } from '../game/fleet';
import type { Cell, ShipPlacement } from '../game/types';
import type { EnemyView } from '../game/view';
import { drawShip } from './ships';
import { C, FONT_DISPLAY, rgba } from './theme';

const shipKey = (s: ShipPlacement) => `${s.kind}:${s.x},${s.y},${s.dir}`;

/** Merkt sich, wann Schiffe versenkt wurden (für die Zerbrech-Animation). */
export class SunkClock {
  private map = new Map<string, number>();
  mark(s: ShipPlacement, t = performance.now()) {
    if (!this.map.has(shipKey(s))) this.map.set(shipKey(s), t);
  }
  get(s: ShipPlacement) {
    return this.map.get(shipKey(s)) ?? 0;
  }
  clear() {
    this.map.clear();
  }
}

function missMark(ctx: CanvasRenderingContext2D, c: Cell, color: string) {
  ctx.strokeStyle = rgba(color, 0.45);
  ctx.lineWidth = 0.035;
  ctx.beginPath();
  ctx.arc(c.x + 0.5, c.y + 0.5, 0.2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = rgba(color, 0.7);
  ctx.beginPath();
  ctx.arc(c.x + 0.5, c.y + 0.5, 0.06, 0, Math.PI * 2);
  ctx.fill();
}

function fireMark(ctx: CanvasRenderingContext2D, c: Cell, now: number, strong = true) {
  const x = c.x + 0.5, y = c.y + 0.5;
  const f = 0.7 + 0.3 * Math.sin(now / 80 + c.x * 1.3 + c.y) * Math.sin(now / 31 + c.y);
  ctx.save();
  ctx.globalCompositeOperation = C.blend;
  const g = ctx.createRadialGradient(x, y, 0.02, x, y, 0.62);
  g.addColorStop(0, rgba('#fff4c4', (strong ? 0.9 : 0.5) * f));
  g.addColorStop(0.3, rgba(C.orange, 0.75 * f));
  g.addColorStop(1, rgba(C.red, 0));
  ctx.fillStyle = g;
  ctx.fillRect(c.x - 0.1, c.y - 0.1, 1.2, 1.2);
  ctx.restore();
  ctx.strokeStyle = rgba(C.red, 0.95);
  ctx.lineWidth = 0.07;
  ctx.lineCap = 'round';
  const r = 0.24;
  ctx.beginPath();
  ctx.moveTo(x - r, y - r);
  ctx.lineTo(x + r, y + r);
  ctx.moveTo(x + r, y - r);
  ctx.lineTo(x - r, y + r);
  ctx.stroke();
}

function mineMark(ctx: CanvasRenderingContext2D, c: Cell, now: number, exploded: boolean) {
  const x = c.x + 0.5, y = c.y + 0.5;
  const pulse = 0.6 + 0.4 * Math.sin(now / 200 + c.x);
  ctx.save();
  if (exploded) {
    ctx.globalCompositeOperation = C.blend;
    ctx.fillStyle = rgba(C.yellow, 0.18 * pulse);
    ctx.fillRect(c.x + 0.04, c.y + 0.04, 0.92, 0.92);
  }
  ctx.strokeStyle = rgba(C.yellow, exploded ? 0.95 : 0.8);
  ctx.fillStyle = rgba(C.yellow, exploded ? 0.25 : 0.12);
  ctx.lineWidth = 0.05;
  ctx.beginPath();
  ctx.moveTo(x, y - 0.3);
  ctx.lineTo(x + 0.3, y + 0.24);
  ctx.lineTo(x - 0.3, y + 0.24);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = C.yellow;
  ctx.font = `900 0.32px ${FONT_DISPLAY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', x, y + 0.04);
  ctx.restore();
}

function signalMark(ctx: CanvasRenderingContext2D, c: Cell, now: number) {
  const x = c.x + 0.5, y = c.y + 0.5;
  const p = 0.5 + 0.5 * Math.sin(now / 220 + c.x + c.y);
  ctx.save();
  ctx.globalCompositeOperation = C.blend;
  ctx.fillStyle = rgba(C.green, 0.12 + 0.12 * p);
  ctx.fillRect(c.x + 0.06, c.y + 0.06, 0.88, 0.88);
  ctx.strokeStyle = rgba(C.green, 0.9);
  ctx.lineWidth = 0.045;
  ctx.setLineDash([0.12, 0.08]);
  ctx.lineDashOffset = -now / 300;
  ctx.beginPath();
  ctx.moveTo(x, y - 0.36);
  ctx.lineTo(x + 0.36, y);
  ctx.lineTo(x, y + 0.36);
  ctx.lineTo(x - 0.36, y);
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = rgba(C.green, 0.95);
  ctx.beginPath();
  ctx.arc(x, y, 0.07, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function emptyMark(ctx: CanvasRenderingContext2D, c: Cell) {
  ctx.strokeStyle = rgba(C.yellow, 0.35);
  ctx.lineWidth = 0.03;
  ctx.strokeRect(c.x + 0.3, c.y + 0.3, 0.4, 0.4);
  ctx.beginPath();
  ctx.moveTo(c.x + 0.3, c.y + 0.7);
  ctx.lineTo(c.x + 0.7, c.y + 0.3);
  ctx.stroke();
}

export function areaBox(ctx: CanvasRenderingContext2D, area: Cell[], color: string, now: number, dashed = true, fill = 0.06) {
  if (!area.length) return;
  const xs = area.map((a) => a.x), ys = area.map((a) => a.y);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs) + 1, y1 = Math.max(...ys) + 1;
  ctx.fillStyle = rgba(color, fill);
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  ctx.strokeStyle = rgba(color, 0.75);
  ctx.lineWidth = 0.045;
  if (dashed) {
    ctx.setLineDash([0.2, 0.12]);
    ctx.lineDashOffset = -now / 500;
  }
  ctx.strokeRect(x0 + 0.03, y0 + 0.03, x1 - x0 - 0.06, y1 - y0 - 0.06);
  ctx.setLineDash([]);
}

export interface EnemySceneData {
  view: EnemyView;
  sunk: SunkClock;
  /** Am Spielende: aufgedeckte gegnerische Schiffe. */
  reveal?: ShipPlacement[] | null;
  revealMines?: Cell[] | null;
  round: number;
  /** Zellen, deren Markierung erst nach Einschlag erscheint (idx → Zeitpunkt). */
  hold?: Map<number, number>;
}

const held = (hold: Map<number, number> | undefined, k: number, now: number) => !!hold && (hold.get(k) ?? 0) > now;

export function paintEnemy(ctx: CanvasRenderingContext2D, now: number, d: EnemySceneData) {
  const v = d.view;
  // Aufgedeckte Flotte (Spielende) dezent unter den Markierungen
  if (d.reveal) {
    for (const s of d.reveal) {
      if (v.sunk.some((k) => k.id === s.id || (k.x === s.x && k.y === s.y && k.dir === s.dir && k.kind === s.kind))) continue;
      drawShip(ctx, s.kind, s.x, s.y, s.dir, now, { color: C.pink, dim: true });
    }
  }
  if (d.revealMines) for (const m of d.revealMines) if (v.cells[idx(m.x, m.y)] !== 'mine') mineMark(ctx, m, now, false);
  for (const s of v.sunk) {
    if (shipCells(s).some((c) => held(d.hold, idx(c.x, c.y), now))) continue;
    drawShip(ctx, s.kind, s.x, s.y, s.dir, now, { sunk: true, sunkAt: d.sunk.get(s) });
  }
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const c = { x, y };
      if (held(d.hold, idx(x, y), now)) continue;
      switch (v.cells[idx(x, y)]) {
        case 'miss':
          missMark(ctx, c, C.cyan);
          break;
        case 'hit':
          fireMark(ctx, c, now);
          break;
        case 'sunk': {
          ctx.fillStyle = rgba(C.red, 0.1);
          ctx.fillRect(x + 0.03, y + 0.03, 0.94, 0.94);
          break;
        }
        case 'mine':
          mineMark(ctx, c, now, true);
          break;
        case 'ship':
          signalMark(ctx, c, now);
          break;
        case 'empty':
          emptyMark(ctx, c);
          break;
      }
    }
  // Radar-Ergebnisse der letzten Runden
  const recent = v.radar.filter((r) => d.round - r.round <= 3).slice(-4);
  for (const r of recent) {
    const area: Cell[] = [];
    const cx = Math.min(Math.max(r.x, 1), N - 2), cy = Math.min(Math.max(r.y, 1), N - 2);
    for (let yy = cy - 1; yy <= cy + 1; yy++) for (let xx = cx - 1; xx <= cx + 1; xx++) area.push({ x: xx, y: yy });
    const col = r.count > 0 ? C.green : C.violet;
    areaBox(ctx, area, col, now, true, 0.035);
    ctx.font = `800 0.6px ${FONT_DISPLAY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = C.badge;
    ctx.beginPath();
    ctx.arc(cx + 0.5, cy + 0.5, 0.36, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 0.04;
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.fillText(String(r.count), cx + 0.5, cy + 0.54);
  }
}

export interface OwnSceneData {
  fleet: FleetState;
  sunk: SunkClock;
  empArea: Cell[];
  selectable?: (shipId: number) => boolean;
  selectedShip?: number | null;
  hideShips?: boolean;
  hold?: Map<number, number>;
}

export function paintOwn(ctx: CanvasRenderingContext2D, now: number, d: OwnSceneData) {
  const f = d.fleet;
  if (d.empArea.length) {
    areaBox(ctx, d.empArea, C.violet, now, true, 0.12);
  }
  // Minen
  for (const m of f.mines) mineMark(ctx, m, now, m.triggered);
  // Hologramm
  if (f.hologram) {
    const h = f.hologram;
    const flick = Math.random() < 0.05 ? 0.3 : 0.7 + 0.3 * Math.sin(now / 120);
    ctx.save();
    ctx.globalAlpha = flick;
    drawShip(ctx, 'skiff', h.x, h.y, 'h', now, { color: C.violet });
    ctx.strokeStyle = rgba(C.violet, 0.5);
    ctx.lineWidth = 0.02;
    for (let i = 0; i < 5; i++) {
      const yy = h.y + 0.1 + i * 0.2 + ((now / 400) % 0.2);
      ctx.beginPath();
      ctx.moveTo(h.x + 0.1, yy);
      ctx.lineTo(h.x + 0.9, yy);
      ctx.stroke();
    }
    ctx.restore();
  }
  // Schiffe
  if (!d.hideShips) {
    for (const s of f.ships) {
      const sel = d.selectedShip === s.id;
      const selectable = d.selectable ? d.selectable(s.id) : false;
      const cells = shipCells(s);
      drawShip(ctx, s.kind, s.x, s.y, s.dir, now, {
        hits: s.hits.map((hit, i) => hit && !held(d.hold, idx(cells[i].x, cells[i].y), now)),
        sunk: s.sunk,
        sunkAt: s.sunk ? d.sunk.get(s) : 0,
        shield: s.shield,
        selected: sel,
        dim: !!d.selectable && !selectable && !sel,
      });
    }
  }
  // Fehlschüsse & Treffer des Gegners
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const k = idx(x, y);
      if (!f.shot[k] || held(d.hold, k, now)) continue;
      const c = { x, y };
      const onShip = f.ships.some((s) => shipCells(s).some((sc) => sc.x === x && sc.y === y));
      const isMine = f.mines.some((m) => m.x === x && m.y === y);
      const isHolo = f.hologram && f.hologram.x === x && f.hologram.y === y;
      if (isHolo) fireMark(ctx, c, now, false);
      else if (!onShip && !isMine) missMark(ctx, c, C.pink);
      else if (onShip && d.hideShips) fireMark(ctx, c, now);
    }
}

/** Fadenkreuz über einer Zellmenge. */
export function paintCrosshair(ctx: CanvasRenderingContext2D, now: number, cells: Cell[], color: string, valid = true) {
  if (!cells.length) return;
  const col = valid ? color : C.red;
  const pulse = 0.5 + 0.5 * Math.sin(now / 140);
  ctx.save();
  ctx.globalCompositeOperation = C.blend;
  for (const c of cells) {
    ctx.fillStyle = rgba(col, 0.12 + 0.1 * pulse);
    ctx.fillRect(c.x, c.y, 1, 1);
  }
  ctx.restore();
  const xs = cells.map((a) => a.x), ys = cells.map((a) => a.y);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs) + 1, y1 = Math.max(...ys) + 1;
  const g = 0.08 + 0.06 * pulse;
  const L = Math.min(0.35, (x1 - x0) / 3);
  ctx.strokeStyle = col;
  ctx.lineWidth = 0.07;
  ctx.lineCap = 'square';
  for (const [cx, cy, dx, dy] of [
    [x0 - g, y0 - g, 1, 1],
    [x1 + g, y0 - g, -1, 1],
    [x0 - g, y1 + g, 1, -1],
    [x1 + g, y1 + g, -1, -1],
  ]) {
    ctx.beginPath();
    ctx.moveTo(cx + dx * L, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + dy * L);
    ctx.stroke();
  }
  // Mittelkreuz
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  ctx.lineWidth = 0.035;
  ctx.beginPath();
  ctx.arc(mx, my, 0.18 + 0.05 * pulse, 0, Math.PI * 2);
  ctx.moveTo(mx - 0.42, my);
  ctx.lineTo(mx - 0.22, my);
  ctx.moveTo(mx + 0.22, my);
  ctx.lineTo(mx + 0.42, my);
  ctx.moveTo(mx, my - 0.42);
  ctx.lineTo(mx, my - 0.22);
  ctx.moveTo(mx, my + 0.22);
  ctx.lineTo(mx, my + 0.42);
  ctx.stroke();
}
