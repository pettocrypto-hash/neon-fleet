import { settings } from '../app/settings';
import { COLS, N } from '../game/board';
import type { Cell } from '../game/types';
import { FxLayer } from './fx';
import { C, FONT_DISPLAY, rgba } from './theme';

export interface WorldPt {
  x: number;
  y: number;
}

export interface BoardInput {
  onTap?(c: Cell, w: WorldPt): void;
  /** true = Geste wird als Ziehen behandelt (z. B. Schiff verschieben). */
  onDragStart?(c: Cell, w: WorldPt): boolean;
  onDragMove?(w: WorldPt): void;
  onDragEnd?(w: WorldPt, inside: boolean): void;
}

export type Painter = (ctx: CanvasRenderingContext2D, now: number, bv: BoardView) => void;

const MAX_ZOOM = 3.2;

/**
 * Hochauflösendes Spielfeld auf Canvas 2D: skaliert mit devicePixelRatio,
 * reagiert auf Größen-/Orientierungswechsel, unterstützt Pinch-Zoom, Verschieben und Tippen.
 */
export class BoardView {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly fx = new FxLayer();
  input: BoardInput = {};
  painters: Painter[] = [];
  overlays: Painter[] = [];
  /** Hervorgehobene Zeile/Spalte (Fadenkreuz). */
  focus: Cell | null = null;
  tint = C.cyan;
  title = '';

  private w = 1;
  private h = 1;
  private dpr = 1;
  private base = 1;
  private s = 1;
  private camX = 7.5;
  private camY = 7.5;
  private margin: number;
  private raf = 0;
  private last = performance.now();
  private ro: ResizeObserver;
  private pointers = new Map<number, { x: number; y: number; sx: number; sy: number; t: number }>();
  private gesture: 'none' | 'tap' | 'pan' | 'pinch' | 'drag' = 'none';
  private pinch0 = { d: 1, s: 1, wx: 0, wy: 0 };
  private running = false;

  constructor(
    readonly host: HTMLElement,
    readonly opts: { labels?: boolean; interactive?: boolean; zoomable?: boolean } = {},
  ) {
    this.margin = opts.labels === false ? 0.15 : 0.85;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'board-canvas';
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d', { alpha: true })!;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    window.addEventListener('orientationchange', this.onOrient);
    if (opts.interactive !== false) this.bindInput();
    this.resize();
    this.start();
  }

  private onOrient = () => setTimeout(() => this.resize(), 250);

  destroy() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    window.removeEventListener('orientationchange', this.onOrient);
    this.canvas.remove();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      if (!this.canvas.isConnected) return;
      this.frame(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  // ---------- Geometrie ----------

  private get extent() {
    return { x0: -this.margin, y0: -this.margin, x1: N + 0.15, y1: N + 0.15 };
  }

  resize() {
    const r = this.host.getBoundingClientRect();
    const w = Math.max(1, Math.floor(r.width));
    const h = Math.max(1, Math.floor(r.height));
    const cap = settings.quality === 'low' ? 1.5 : settings.quality === 'medium' ? 2 : 3;
    const dpr = Math.min(cap, window.devicePixelRatio || 1);
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    const zoomRatio = this.s && this.base ? this.s / this.base : 1;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    const e = this.extent;
    this.base = Math.min(w / (e.x1 - e.x0), h / (e.y1 - e.y0));
    this.s = this.base * zoomRatio;
    this.clampCam();
  }

  /** Koordinaten-Beschriftung ein-/ausblenden (z. B. Minimap). */
  setLabels(on: boolean) {
    this.opts.labels = on;
    this.margin = on ? 0.85 : 0.15;
    this.w = 0;
    this.s = 0;
    this.resize();
    this.resetZoom();
  }

  get zoom() {
    return this.s / this.base;
  }

  resetZoom() {
    this.s = this.base;
    this.clampCam();
  }

  private clampCam() {
    const e = this.extent;
    const hw = this.w / (2 * this.s), hh = this.h / (2 * this.s);
    const cx = (e.x0 + e.x1) / 2, cy = (e.y0 + e.y1) / 2;
    this.camX = hw * 2 >= e.x1 - e.x0 ? cx : Math.min(e.x1 - hw, Math.max(e.x0 + hw, this.camX));
    this.camY = hh * 2 >= e.y1 - e.y0 ? cy : Math.min(e.y1 - hh, Math.max(e.y0 + hh, this.camY));
  }

  toWorld(px: number, py: number): WorldPt {
    return { x: (px - this.w / 2) / this.s + this.camX, y: (py - this.h / 2) / this.s + this.camY };
  }

  clientToWorld(cx: number, cy: number): WorldPt {
    const r = this.canvas.getBoundingClientRect();
    return this.toWorld(cx - r.left, cy - r.top);
  }

  /** Bildschirmposition (CSS px relativ zum Canvas) einer Weltkoordinate. */
  toScreen(wx: number, wy: number): WorldPt {
    return { x: (wx - this.camX) * this.s + this.w / 2, y: (wy - this.camY) * this.s + this.h / 2 };
  }

  cellAt(w: WorldPt): Cell | null {
    const x = Math.floor(w.x), y = Math.floor(w.y);
    return x >= 0 && y >= 0 && x < N && y < N ? { x, y } : null;
  }

  get cellPx() {
    return this.s;
  }

  /** Sorgt dafür, dass eine Zelle sichtbar ist (bei Zoom). */
  ensureVisible(c: Cell) {
    const hw = this.w / (2 * this.s), hh = this.h / (2 * this.s);
    if (c.x + 0.5 < this.camX - hw + 1 || c.x + 0.5 > this.camX + hw - 1) this.camX = c.x + 0.5;
    if (c.y + 0.5 < this.camY - hh + 1 || c.y + 0.5 > this.camY + hh - 1) this.camY = c.y + 0.5;
    this.clampCam();
  }

  // ---------- Eingabe ----------

  private bindInput() {
    const el = this.canvas;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e, false));
    el.addEventListener('pointercancel', (e) => this.up(e, true));
    el.addEventListener(
      'wheel',
      (e) => {
        if (this.opts.zoomable === false) return;
        e.preventDefault();
        const r = el.getBoundingClientRect();
        this.zoomAt(e.clientX - r.left, e.clientY - r.top, this.s * Math.exp(-e.deltaY * 0.0015));
      },
      { passive: false },
    );
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private zoomAt(px: number, py: number, newS: number) {
    const wp = this.toWorld(px, py);
    this.s = Math.min(this.base * MAX_ZOOM, Math.max(this.base, newS));
    this.camX = wp.x - (px - this.w / 2) / this.s;
    this.camY = wp.y - (py - this.h / 2) / this.s;
    this.clampCam();
  }

  private local(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private down(e: PointerEvent) {
    const p = this.local(e);
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: p.x, y: p.y, sx: p.x, sy: p.y, t: performance.now() });
    if (this.pointers.size === 2 && this.opts.zoomable !== false) {
      if (this.gesture === 'drag') this.input.onDragEnd?.(this.toWorld(p.x, p.y), false);
      this.gesture = 'pinch';
      const [a, b] = [...this.pointers.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const wp = this.toWorld(mid.x, mid.y);
      this.pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: this.s, wx: wp.x, wy: wp.y };
      return;
    }
    if (this.pointers.size > 1) return;
    const w = this.toWorld(p.x, p.y);
    const c = this.cellAt(w);
    if (c && this.input.onDragStart?.(c, w)) {
      this.gesture = 'drag';
      return;
    }
    this.gesture = 'tap';
  }

  private move(e: PointerEvent) {
    const ptr = this.pointers.get(e.pointerId);
    if (!ptr) return;
    const p = this.local(e);
    const dx = p.x - ptr.x, dy = p.y - ptr.y;
    ptr.x = p.x;
    ptr.y = p.y;
    if (this.gesture === 'pinch' && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.s = Math.min(this.base * MAX_ZOOM, Math.max(this.base, (this.pinch0.s * d) / this.pinch0.d));
      this.camX = this.pinch0.wx - (mid.x - this.w / 2) / this.s;
      this.camY = this.pinch0.wy - (mid.y - this.h / 2) / this.s;
      this.clampCam();
      return;
    }
    if (this.gesture === 'drag') {
      this.input.onDragMove?.(this.toWorld(p.x, p.y));
      return;
    }
    if (this.gesture === 'tap' && Math.hypot(p.x - ptr.sx, p.y - ptr.sy) > 10) this.gesture = this.zoom > 1.01 ? 'pan' : 'none';
    if (this.gesture === 'pan') {
      this.camX -= dx / this.s;
      this.camY -= dy / this.s;
      this.clampCam();
    }
  }

  private up(e: PointerEvent, cancel: boolean) {
    const ptr = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (!ptr) return;
    const p = this.local(e);
    if (this.gesture === 'drag') {
      const w = this.toWorld(p.x, p.y);
      this.input.onDragEnd?.(w, !cancel && !!this.cellAt(w));
      this.gesture = 'none';
      return;
    }
    if (this.gesture === 'pinch') {
      if (this.pointers.size === 0) this.gesture = 'none';
      return;
    }
    if (this.gesture === 'tap' && !cancel && performance.now() - ptr.t < 600) {
      const w = this.toWorld(p.x, p.y);
      const c = this.cellAt(w);
      if (c) this.input.onTap?.(c, w);
    }
    if (this.pointers.size === 0) this.gesture = 'none';
  }

  // ---------- Zeichnen ----------

  private frame(now: number) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const [sx, sy] = this.fx.shakeOffset(now);
    const k = this.s * this.dpr;
    ctx.setTransform(k, 0, 0, k, (this.w / 2 - this.camX * this.s) * this.dpr + sx * k, (this.h / 2 - this.camY * this.s) * this.dpr + sy * k);
    this.drawGrid(ctx, now);
    for (const p of this.painters) {
      ctx.save();
      p(ctx, now, this);
      ctx.restore();
    }
    this.fx.draw(ctx, now, dt);
    for (const p of this.overlays) {
      ctx.save();
      p(ctx, now, this);
      ctx.restore();
    }
  }

  private drawGrid(ctx: CanvasRenderingContext2D, now: number) {
    const tint = this.tint;
    // Panel
    const g = ctx.createLinearGradient(0, 0, N, N);
    g.addColorStop(0, C.panel0);
    g.addColorStop(1, C.panel1);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, N, N);

    // Fadenkreuz-Zeile/Spalte
    if (this.focus) {
      ctx.fillStyle = rgba(tint, 0.07);
      ctx.fillRect(0, this.focus.y, N, 1);
      ctx.fillRect(this.focus.x, 0, 1, N);
    }

    // Lauflicht-Scanline über das Raster
    if (settings.quality !== 'low') {
      const sy = ((now / 3000) % 1) * (N + 2) - 1;
      const sg = ctx.createLinearGradient(0, sy - 1, 0, sy + 0.2);
      sg.addColorStop(0, rgba(tint, 0));
      sg.addColorStop(1, rgba(tint, 0.07));
      ctx.fillStyle = sg;
      ctx.fillRect(0, Math.max(0, sy - 1), N, Math.min(N, sy + 0.2) - Math.max(0, sy - 1));
    }

    // Linien
    const px = 1 / this.s;
    ctx.lineWidth = px;
    ctx.strokeStyle = rgba(tint, 0.16);
    ctx.beginPath();
    for (let i = 1; i < N; i++) {
      ctx.moveTo(i, 0);
      ctx.lineTo(i, N);
      ctx.moveTo(0, i);
      ctx.lineTo(N, i);
    }
    ctx.stroke();
    // Kreuzungspunkte
    ctx.fillStyle = rgba(tint, 0.45);
    if (this.s > 14) for (let y = 1; y < N; y++) for (let x = 1; x < N; x++) ctx.fillRect(x - px, y - px, 2 * px, 2 * px);
    // Rahmen mit Glow
    ctx.save();
    ctx.globalCompositeOperation = C.blend;
    ctx.strokeStyle = rgba(tint, 0.18);
    ctx.lineWidth = 6 * px;
    ctx.strokeRect(0, 0, N, N);
    ctx.restore();
    ctx.strokeStyle = rgba(tint, 0.85);
    ctx.lineWidth = 1.5 * px;
    ctx.strokeRect(0, 0, N, N);
    // Ecken-Akzente
    ctx.strokeStyle = C.pink;
    ctx.lineWidth = 2.5 * px;
    const L = 0.8;
    for (const [cx, cy, dx, dy] of [
      [0, 0, 1, 1],
      [N, 0, -1, 1],
      [0, N, 1, -1],
      [N, N, -1, -1],
    ]) {
      ctx.beginPath();
      ctx.moveTo(cx + dx * L, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + dy * L);
      ctx.stroke();
    }

    if (this.opts.labels !== false) {
      ctx.font = `600 0.42px ${FONT_DISPLAY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < N; i++) {
        const hiX = this.focus?.x === i, hiY = this.focus?.y === i;
        ctx.fillStyle = hiX ? C.pink : rgba(tint, 0.75);
        ctx.fillText(COLS[i], i + 0.5, -0.42);
        ctx.fillStyle = hiY ? C.pink : rgba(tint, 0.75);
        ctx.fillText(String(i + 1), -0.45, i + 0.53);
      }
    }
  }
}
