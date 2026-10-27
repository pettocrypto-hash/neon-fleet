import { SHIP_LENGTH, type ShipKind } from '../config/balance';
import type { Dir } from '../game/types';
import { C, rgba } from './theme';

export interface ShipDrawOpts {
  color?: string;
  hits?: boolean[];
  sunk?: boolean;
  /** Zeitpunkt (ms) des Versenkens – für die Zerbrech-Animation. */
  sunkAt?: number;
  shield?: boolean;
  ghost?: boolean;
  invalid?: boolean;
  selected?: boolean;
  glow?: number;
  dim?: boolean;
}

type Pt = [number, number];

/**
 * Zeichnet ein Schiff prozedural. Lokales Koordinatensystem: Heck bei x=0, Bug bei x=L,
 * Rumpf um y=0 zentriert (Breite ~0.8). Einheit = 1 Zelle.
 */
export function drawShip(
  ctx: CanvasRenderingContext2D,
  kind: ShipKind,
  x: number,
  y: number,
  dir: Dir,
  now: number,
  o: ShipDrawOpts = {},
) {
  const L = SHIP_LENGTH[kind];
  const color = o.invalid ? C.red : (o.color ?? C.cyan);
  ctx.save();
  if (dir === 'h') ctx.translate(x, y + 0.5);
  else {
    ctx.translate(x + 0.5, y);
    ctx.rotate(Math.PI / 2);
  }
  const alpha = o.ghost ? 0.55 : o.dim ? 0.55 : 1;
  ctx.globalAlpha *= alpha;

  // Zerbrech-Animation: zwei Hälften driften auseinander.
  const breakT = o.sunk && o.sunkAt ? Math.min(1, (now - o.sunkAt) / 900) : o.sunk ? 1 : 0;
  if (o.sunk) {
    const split = L / 2 + (L % 2 ? 0.5 : 0);
    const ease = 1 - (1 - breakT) ** 3;
    for (const half of [0, 1]) {
      ctx.save();
      ctx.beginPath();
      if (half === 0) ctx.rect(-0.2, -0.7, split + 0.2, 1.4);
      else ctx.rect(split, -0.7, L - split + 0.4, 1.4);
      ctx.clip();
      const dx = (half ? 0.12 : -0.12) * ease;
      const rot = (half ? 0.1 : -0.08) * ease;
      ctx.translate(split + dx, 0.03 * ease);
      ctx.rotate(rot);
      ctx.translate(-split, 0);
      paintHull(ctx, kind, L, C.red, now, o, true);
      ctx.restore();
    }
    // Riss-Glühen
    ctx.globalCompositeOperation = C.blend;
    ctx.strokeStyle = rgba(C.orange, 0.8 * (1 - breakT * 0.6));
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    const s = L / 2 + (L % 2 ? 0.5 : 0);
    ctx.moveTo(s, -0.42);
    ctx.lineTo(s - 0.08, -0.15);
    ctx.lineTo(s + 0.07, 0.1);
    ctx.lineTo(s - 0.04, 0.42);
    ctx.stroke();
    ctx.restore();
    return;
  }

  paintHull(ctx, kind, L, color, now, o, false);

  // Treffer: glühende Segmente
  if (o.hits) {
    ctx.globalCompositeOperation = C.blend;
    for (let i = 0; i < o.hits.length; i++) {
      if (!o.hits[i]) continue;
      const flick = 0.65 + 0.35 * Math.sin(now / 90 + i * 2.1) * Math.sin(now / 37 + i);
      const g = ctx.createRadialGradient(i + 0.5, 0, 0.02, i + 0.5, 0, 0.55);
      g.addColorStop(0, rgba('#fff2c0', 0.95 * flick));
      g.addColorStop(0.35, rgba(C.orange, 0.8 * flick));
      g.addColorStop(1, rgba(C.red, 0));
      ctx.fillStyle = g;
      ctx.fillRect(i, -0.55, 1, 1.1);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  if (o.shield) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 300);
    ctx.strokeStyle = rgba(C.green, 0.5 + 0.4 * pulse);
    ctx.fillStyle = rgba(C.green, 0.07 + 0.05 * pulse);
    ctx.lineWidth = 0.05;
    roundRect(ctx, -0.08, -0.5, L + 0.16, 1, 0.5);
    ctx.fill();
    ctx.stroke();
    // Hex-Muster angedeutet
    ctx.strokeStyle = rgba(C.green, 0.18);
    ctx.lineWidth = 0.02;
    for (let i = 0.25; i < L; i += 0.5) {
      ctx.beginPath();
      ctx.moveTo(i, -0.45);
      ctx.lineTo(i + 0.25, 0);
      ctx.lineTo(i, 0.45);
      ctx.stroke();
    }
  }

  if (o.selected) {
    const pulse = 0.6 + 0.4 * Math.sin(now / 150);
    ctx.strokeStyle = rgba(C.yellow, pulse);
    ctx.lineWidth = 0.05;
    ctx.setLineDash([0.18, 0.12]);
    ctx.lineDashOffset = -now / 400;
    ctx.strokeRect(-0.02, -0.52, L + 0.04, 1.04);
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function poly(ctx: CanvasRenderingContext2D, pts: Pt[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

/** Spiegelt eine obere Kontur (y<0) an der Längsachse zu einem geschlossenen Polygon. */
function mirrored(top: Pt[]): Pt[] {
  return [...top, ...[...top].reverse().map(([px, py]) => [px, -py] as Pt)];
}

function hullShape(kind: ShipKind): Pt[] {
  switch (kind) {
    case 'dreadnought':
      // massiv und eckig, gestufte Panzerung
      return mirrored([
        [0.08, -0.22],
        [0.2, -0.38],
        [1.2, -0.38],
        [1.35, -0.44],
        [3.6, -0.44],
        [3.8, -0.36],
        [5.0, -0.36],
        [5.3, -0.26],
        [5.85, -0.12],
        [5.95, 0],
      ]);
    case 'carrier':
      // breites, flaches Deck
      return mirrored([
        [0.1, -0.3],
        [0.25, -0.42],
        [4.3, -0.42],
        [4.75, -0.3],
        [4.95, -0.08],
      ]);
    case 'cruiser':
      return mirrored([
        [0.1, -0.2],
        [0.3, -0.34],
        [2.6, -0.34],
        [3.3, -0.22],
        [3.95, -0.02],
      ]);
    case 'destroyer':
      return mirrored([
        [0.1, -0.18],
        [0.25, -0.3],
        [1.6, -0.3],
        [2.2, -0.2],
        [2.96, -0.02],
      ]);
    case 'interceptor':
      // schlank und spitz, gepfeilte Flügel
      return mirrored([
        [0.12, -0.08],
        [0.2, -0.42],
        [0.55, -0.42],
        [0.95, -0.14],
        [1.5, -0.1],
        [1.97, -0.01],
      ]);
    case 'skiff':
    default:
      return [];
  }
}

function paintHull(ctx: CanvasRenderingContext2D, kind: ShipKind, _len: number, color: string, now: number, o: ShipDrawOpts, wreck: boolean) {
  const glow = o.glow ?? 1;
  const lw = 0.045;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (kind === 'skiff') {
    paintSkiff(ctx, color, now, wreck, glow);
    return;
  }

  const shape = hullShape(kind);
  // Triebwerke (hinter dem Rumpf)
  if (!wreck) paintEngines(ctx, kind, color, now);

  // Rumpf-Füllung mit Verlauf
  poly(ctx, shape);
  const grad = ctx.createLinearGradient(0, -0.45, 0, 0.45);
  grad.addColorStop(0, rgba(color, wreck ? 0.12 : 0.22));
  grad.addColorStop(0.5, wreck ? C.wreckHull : C.hull);
  grad.addColorStop(1, rgba(color, wreck ? 0.1 : 0.18));
  ctx.fillStyle = grad;
  ctx.fill();

  // Neon-Kontur: breiter weicher Schein + scharfe Linie
  if (glow > 0) {
    ctx.save();
    ctx.globalCompositeOperation = C.blend;
    ctx.strokeStyle = rgba(color, wreck ? 0.12 : 0.22 * glow);
    ctx.lineWidth = lw * 4;
    ctx.stroke();
    ctx.restore();
  }
  ctx.strokeStyle = rgba(color, wreck ? 0.55 : 0.95);
  ctx.lineWidth = lw;
  ctx.stroke();

  // Details
  ctx.strokeStyle = rgba(color, wreck ? 0.3 : 0.55);
  ctx.fillStyle = rgba(color, wreck ? 0.3 : 0.75);
  ctx.lineWidth = 0.025;
  switch (kind) {
    case 'dreadnought': {
      // Panzerplatten
      for (const px of [1.35, 2.2, 3.0, 3.8]) line(ctx, px, -0.42, px, 0.42);
      line(ctx, 0.4, 0, 5.4, 0);
      for (const py of [-0.24, 0.24]) line(ctx, 1.4, py, 3.6, py);
      // Türme
      for (const tx of [1.75, 2.6, 4.4]) turret(ctx, tx, 0, 0.17, color, wreck, 0.55);
      // Energiekerne
      core(ctx, 3.3, 0, 0.11, wreck ? C.red : C.pink, now, wreck);
      core(ctx, 0.85, 0, 0.09, wreck ? C.red : C.pink, now + 400, wreck);
      // Brücke
      ctx.strokeRect(5.0, -0.12, 0.35, 0.24);
      break;
    }
    case 'carrier': {
      // Landedeck-Streifen
      ctx.save();
      ctx.setLineDash([0.18, 0.12]);
      line(ctx, 0.5, 0, 4.4, 0);
      ctx.restore();
      line(ctx, 0.5, -0.3, 4.2, -0.3);
      line(ctx, 0.5, 0.3, 4.2, 0.3);
      for (let i = 0; i < 4; i++) chevron(ctx, 3.2 + i * 0.28, 0, 0.12);
      // Insel (Tower)
      ctx.fillStyle = rgba(color, wreck ? 0.2 : 0.35);
      ctx.fillRect(1.6, -0.42, 0.9, 0.14);
      ctx.strokeRect(1.6, -0.42, 0.9, 0.14);
      // Deckbeleuchtung
      if (!wreck) {
        for (let i = 0; i < 7; i++) {
          const on = Math.floor(now / 140) % 7 === i;
          ctx.fillStyle = rgba(on ? C.yellow : color, on ? 1 : 0.4);
          ctx.fillRect(0.6 + i * 0.55, 0.33, 0.07, 0.05);
        }
      }
      core(ctx, 0.8, 0, 0.1, wreck ? C.red : C.pink, now, wreck);
      break;
    }
    case 'cruiser': {
      for (const px of [1.0, 2.0]) line(ctx, px, -0.32, px, 0.32);
      line(ctx, 0.3, 0, 3.4, 0);
      turret(ctx, 1.5, 0, 0.15, color, wreck, 0.5);
      turret(ctx, 2.65, 0, 0.13, color, wreck, 0.45);
      // Seitenflossen
      poly(ctx, [[0.6, -0.34], [1.2, -0.34], [0.8, -0.5]]);
      ctx.stroke();
      poly(ctx, [[0.6, 0.34], [1.2, 0.34], [0.8, 0.5]]);
      ctx.stroke();
      core(ctx, 0.65, 0, 0.09, wreck ? C.red : C.pink, now, wreck);
      break;
    }
    case 'destroyer': {
      line(ctx, 0.3, 0, 2.5, 0);
      line(ctx, 1.1, -0.28, 1.1, 0.28);
      turret(ctx, 1.75, 0, 0.13, color, wreck, 0.45);
      core(ctx, 0.65, 0, 0.09, wreck ? C.red : C.pink, now, wreck);
      break;
    }
    case 'interceptor': {
      line(ctx, 0.3, 0, 1.8, 0);
      poly(ctx, [[1.2, -0.06], [1.55, 0], [1.2, 0.06]]);
      ctx.fillStyle = rgba(C.yellow, wreck ? 0.2 : 0.8);
      ctx.fill();
      core(ctx, 0.55, 0, 0.07, wreck ? C.red : C.pink, now, wreck);
      break;
    }
  }
}

function paintEngines(ctx: CanvasRenderingContext2D, kind: ShipKind, color: string, now: number) {
  const engines: number[] =
    kind === 'dreadnought' ? [-0.24, 0, 0.24] : kind === 'carrier' ? [-0.22, 0.22] : kind === 'interceptor' ? [-0.28, 0.28] : kind === 'cruiser' ? [-0.15, 0.15] : [0];
  ctx.save();
  ctx.globalCompositeOperation = C.blend;
  for (let i = 0; i < engines.length; i++) {
    const ey = engines[i];
    const flick = 0.75 + 0.25 * Math.sin(now / 45 + i * 1.7) + 0.1 * Math.sin(now / 13 + i);
    const len = 0.32 * flick;
    const g = ctx.createLinearGradient(0.1, 0, -len, 0);
    g.addColorStop(0, rgba('#ffffff', 0.9));
    g.addColorStop(0.3, rgba(color, 0.75));
    g.addColorStop(1, rgba(C.violet, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0.12, ey - 0.07);
    ctx.lineTo(-len, ey);
    ctx.lineTo(0.12, ey + 0.07);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function paintSkiff(ctx: CanvasRenderingContext2D, color: string, now: number, wreck: boolean, glow: number) {
  const cx = 0.5;
  const rot = now / 900;
  ctx.save();
  ctx.translate(cx, 0);
  ctx.beginPath();
  ctx.arc(0, 0, 0.36, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(0, 0, 0.05, 0, 0, 0.36);
  g.addColorStop(0, rgba(color, wreck ? 0.15 : 0.3));
  g.addColorStop(1, C.hull);
  ctx.fillStyle = g;
  ctx.fill();
  if (glow > 0 && !wreck) {
    ctx.save();
    ctx.globalCompositeOperation = C.blend;
    ctx.strokeStyle = rgba(color, 0.22 * glow);
    ctx.lineWidth = 0.16;
    ctx.stroke();
    ctx.restore();
  }
  ctx.strokeStyle = rgba(color, wreck ? 0.5 : 0.95);
  ctx.lineWidth = 0.045;
  ctx.stroke();
  // rotierender Ring mit Lücken
  ctx.rotate(wreck ? 0 : rot);
  ctx.strokeStyle = rgba(color, wreck ? 0.3 : 0.6);
  ctx.lineWidth = 0.03;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(0, 0, 0.24, (i * Math.PI * 2) / 3, (i * Math.PI * 2) / 3 + 1.4);
    ctx.stroke();
  }
  ctx.restore();
  core(ctx, cx, 0, 0.09, wreck ? C.red : C.pink, now, wreck);
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function chevron(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(x - s * 0.6, y - s);
  ctx.lineTo(x, y);
  ctx.lineTo(x - s * 0.6, y + s);
  ctx.stroke();
}

function turret(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, wreck: boolean, barrel: number) {
  ctx.save();
  ctx.strokeStyle = rgba(color, wreck ? 0.35 : 0.85);
  ctx.lineWidth = 0.03;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = C.cockpit;
  ctx.fill();
  ctx.stroke();
  ctx.lineWidth = 0.04;
  line(ctx, x + r * 0.6, y - 0.04, x + r + barrel * 0.5, y - 0.04);
  line(ctx, x + r * 0.6, y + 0.04, x + r + barrel * 0.5, y + 0.04);
  ctx.restore();
}

function core(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, now: number, wreck: boolean) {
  const pulse = wreck ? 0.25 : 0.7 + 0.3 * Math.sin(now / 260 + x * 3);
  ctx.save();
  ctx.globalCompositeOperation = C.blend;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.4);
  g.addColorStop(0, rgba('#ffffff', 0.95 * pulse));
  g.addColorStop(0.3, rgba(color, 0.8 * pulse));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r * 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Kleine Vorschau für das Dock (eigener Canvas, scharf mit DPR). */
export function renderShipPreview(canvas: HTMLCanvasElement, kind: ShipKind, color = C.cyan) {
  const L = SHIP_LENGTH[kind];
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const cell = 22;
  canvas.style.width = `${L * cell}px`;
  canvas.style.height = `${cell}px`;
  canvas.width = Math.round(L * cell * dpr);
  canvas.height = Math.round(cell * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(cell * dpr, 0, 0, cell * dpr, 0, 0);
  ctx.clearRect(0, 0, L, 1);
  drawShip(ctx, kind, 0, 0, 'h', performance.now(), { color });
}
