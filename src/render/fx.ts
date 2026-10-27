import { settings } from '../app/settings';
import type { Cell } from '../game/types';
import { C, FONT_DISPLAY, rgba } from './theme';

/** Partikel und Animationen in Weltkoordinaten (1 = Zelle). */
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  drag: number;
  kind: 'spark' | 'smoke' | 'debris';
}

interface Anim {
  t0: number;
  dur: number;
  draw: (ctx: CanvasRenderingContext2D, p: number, now: number) => void;
}

const qualityFactor = () => (settings.quality === 'high' ? 1 : settings.quality === 'medium' ? 0.55 : 0.25);

export class FxLayer {
  private particles: Particle[] = [];
  private anims: Anim[] = [];
  shake = 0;
  private shakeUntil = 0;

  get busy() {
    return this.particles.length > 0 || this.anims.length > 0;
  }

  clear() {
    this.particles = [];
    this.anims = [];
  }

  addShake(amount: number, ms = 400) {
    if (settings.quality === 'low') amount *= 0.5;
    this.shake = Math.max(this.shake, amount);
    this.shakeUntil = performance.now() + ms;
  }

  shakeOffset(now: number): [number, number] {
    if (now > this.shakeUntil) {
      this.shake = 0;
      return [0, 0];
    }
    const k = this.shake * ((this.shakeUntil - now) / 400);
    return [(Math.random() * 2 - 1) * k, (Math.random() * 2 - 1) * k];
  }

  anim(dur: number, draw: Anim['draw'], delay = 0) {
    this.anims.push({ t0: performance.now() + delay, dur, draw });
  }

  burst(cx: number, cy: number, n: number, colors: string[], speed = 4, kind: Particle['kind'] = 'spark', life = 0.8) {
    const count = Math.max(2, Math.round(n * qualityFactor()));
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.25 + Math.random());
      this.particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0,
        max: life * (0.5 + Math.random()),
        size: kind === 'smoke' ? 0.25 + Math.random() * 0.3 : kind === 'debris' ? 0.06 + Math.random() * 0.08 : 0.03 + Math.random() * 0.05,
        color: colors[Math.floor(Math.random() * colors.length)],
        drag: kind === 'smoke' ? 2.5 : 3.2,
        kind,
      });
    }
    if (this.particles.length > 1400) this.particles.splice(0, this.particles.length - 1400);
  }

  // ---------- fertige Effekte ----------

  explosion(c: Cell, big = false) {
    const x = c.x + 0.5, y = c.y + 0.5;
    this.burst(x, y, big ? 90 : 45, ['#ffffff', C.yellow, C.orange, C.red], big ? 6 : 4.5);
    this.burst(x, y, big ? 24 : 12, [C.orange, C.red], 2.2, 'debris', 1.2);
    this.burst(x, y, big ? 16 : 7, ['#40102a', '#2a0a20'], 1, 'smoke', 1.6);
    this.anim(big ? 650 : 420, (ctx, p) => {
      const r = (big ? 1.8 : 1.1) * (1 - (1 - p) ** 3);
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba('#ffffff', 0.9 * (1 - p)));
      g.addColorStop(0.4, rgba(C.orange, 0.6 * (1 - p)));
      g.addColorStop(1, rgba(C.red, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    });
    this.shockwave(c, big ? C.orange : C.red, big ? 2.4 : 1.4, big ? 700 : 500);
    this.addShake(big ? 0.35 : 0.12, big ? 600 : 300);
  }

  shockwave(c: Cell, color: string, radius: number, dur: number, delay = 0) {
    const x = c.x + 0.5, y = c.y + 0.5;
    this.anim(
      dur,
      (ctx, p) => {
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = rgba(color, 0.9 * (1 - p));
        ctx.lineWidth = 0.08 * (1 - p) + 0.015;
        ctx.beginPath();
        ctx.arc(x, y, 0.1 + radius * p, 0, Math.PI * 2);
        ctx.stroke();
      },
      delay,
    );
  }

  /** Energie-/Wasserwelle bei Fehlschuss. */
  ripple(c: Cell) {
    for (let i = 0; i < 3; i++) this.shockwave(c, C.cyan, 0.9, 900, i * 160);
    this.burst(c.x + 0.5, c.y + 0.5, 14, [C.cyan, '#9ffcff'], 1.6, 'spark', 0.6);
  }

  /** Laser vom unteren Rand zum Ziel. */
  laser(c: Cell, color = C.pink, dur = 260, delay = 0, fromX = 7.5, fromY = 16) {
    const x = c.x + 0.5, y = c.y + 0.5;
    this.anim(
      dur,
      (ctx, p) => {
        const head = Math.min(1, p * 1.6);
        const tail = Math.max(0, p * 1.6 - 0.6);
        const hx = fromX + (x - fromX) * head, hy = fromY + (y - fromY) * head;
        const tx = fromX + (x - fromX) * tail, ty = fromY + (y - fromY) * tail;
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        ctx.strokeStyle = rgba(color, 0.35);
        ctx.lineWidth = 0.22;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(hx, hy);
        ctx.stroke();
        ctx.strokeStyle = rgba('#ffffff', 0.95);
        ctx.lineWidth = 0.05;
        ctx.stroke();
      },
      delay,
    );
  }

  /** Rakete mit Bogenflug. */
  missile(c: Cell, dur = 520, delay = 0, color = C.yellow) {
    const x = c.x + 0.5, y = c.y + 0.5;
    const sx = x + (Math.random() * 4 - 2), sy = 16.5;
    const trail: [number, number][] = [];
    this.anim(
      dur,
      (ctx, p) => {
        const e = p * p;
        const px = sx + (x - sx) * e;
        const py = sy + (y - sy) * e - Math.sin(p * Math.PI) * 2.2;
        trail.push([px, py]);
        if (trail.length > 14) trail.shift();
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 1; i < trail.length; i++) {
          ctx.strokeStyle = rgba(color, (i / trail.length) * 0.6);
          ctx.lineWidth = 0.1 * (i / trail.length);
          ctx.beginPath();
          ctx.moveTo(trail[i - 1][0], trail[i - 1][1]);
          ctx.lineTo(trail[i][0], trail[i][1]);
          ctx.stroke();
        }
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(px, py, 0.09, 0, Math.PI * 2);
        ctx.fill();
      },
      delay,
    );
  }

  /** Radar-Sweep über 3×3. */
  radarSweep(area: Cell[], color = C.green) {
    const xs = area.map((a) => a.x), ys = area.map((a) => a.y);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs) + 1, y1 = Math.max(...ys) + 1;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, r = (x1 - x0) * 0.75;
    this.anim(1300, (ctx, p) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, x1 - x0, y1 - y0);
      ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      const a = p * Math.PI * 4;
      ctx.fillStyle = rgba(color, 0.25 * (1 - p));
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, a - 0.9, a);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = rgba(color, 0.9 * (1 - p * 0.7));
      ctx.lineWidth = 0.04;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = rgba(color, 0.7 * (1 - p));
      ctx.lineWidth = 0.05;
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    });
  }

  /** EMP: violette Blitzwelle. */
  emp(area: Cell[]) {
    const xs = area.map((a) => a.x), ys = area.map((a) => a.y);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs) + 1, y1 = Math.max(...ys) + 1;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    this.shockwave({ x: cx - 0.5, y: cy - 0.5 }, C.violet, 2.6, 800);
    this.shockwave({ x: cx - 0.5, y: cy - 0.5 }, C.pink, 2.0, 700, 120);
    this.anim(900, (ctx, p) => {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(C.violet, 0.9 * (1 - p));
      ctx.lineWidth = 0.04;
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        let px = cx, py = cy;
        ctx.moveTo(px, py);
        for (let s = 0; s < 5; s++) {
          px += (Math.random() * 2 - 1) * 0.5;
          py += (Math.random() * 2 - 1) * 0.5;
          px = Math.min(x1, Math.max(x0, px));
          py = Math.min(y1, Math.max(y0, py));
          ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      ctx.fillStyle = rgba(C.violet, 0.18 * (1 - p));
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    });
    this.addShake(0.15, 400);
  }

  /** Drohne fliegt ein und scannt. */
  drone(c: Cell) {
    const x = c.x + 0.5, y = c.y + 0.5;
    this.anim(1100, (ctx, p, now) => {
      const fly = Math.min(1, p / 0.55);
      const e = 1 - (1 - fly) ** 3;
      const px = -1 + (x + 1) * e, py = y - 3 * (1 - e);
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(C.yellow, 0.9);
      ctx.lineWidth = 0.04;
      ctx.beginPath();
      ctx.arc(px, py, 0.16, 0, Math.PI * 2);
      ctx.stroke();
      const spin = now / 60;
      for (let i = 0; i < 4; i++) {
        const a = spin + (i * Math.PI) / 2;
        ctx.beginPath();
        ctx.arc(px + Math.cos(a) * 0.22, py + Math.sin(a) * 0.22, 0.06, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (p > 0.55) {
        const q = (p - 0.55) / 0.45;
        ctx.fillStyle = rgba(C.yellow, 0.25 * (1 - q));
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(x - 0.5, y + 0.5);
        ctx.lineTo(x + 0.5, y + 0.5);
        ctx.closePath();
        ctx.fill();
      }
    });
  }

  /** Schild-, Reparatur-, Hologramm-, Sprung-Effekte auf dem eigenen Feld. */
  pulseArea(cells: Cell[], color: string, dur = 900) {
    this.anim(dur, (ctx, p) => {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(color, 0.35 * Math.sin(p * Math.PI));
      ctx.strokeStyle = rgba(color, 0.9 * (1 - p));
      ctx.lineWidth = 0.05;
      for (const c of cells) {
        const g = 0.08 + 0.12 * p;
        ctx.fillRect(c.x + g, c.y + g, 1 - 2 * g, 1 - 2 * g);
        ctx.strokeRect(c.x + 0.05, c.y + 0.05, 0.9, 0.9);
      }
    });
    for (const c of cells) this.burst(c.x + 0.5, c.y + 0.5, 8, [color, '#ffffff'], 1.4, 'spark', 0.7);
  }

  beamColumn(cells: Cell[], color: string) {
    this.anim(800, (ctx, p) => {
      ctx.globalCompositeOperation = 'lighter';
      for (const c of cells) {
        const g = ctx.createLinearGradient(0, c.y - 2, 0, c.y + 1);
        g.addColorStop(0, rgba(color, 0));
        g.addColorStop(1, rgba(color, 0.6 * Math.sin(p * Math.PI)));
        ctx.fillStyle = g;
        ctx.fillRect(c.x + 0.25 - 0.15 * Math.sin(p * Math.PI), c.y - 2, 0.5 + 0.3 * Math.sin(p * Math.PI), 3);
      }
    });
  }

  /** Schwebender Text. */
  text(c: Cell, label: string, color: string, delay = 0) {
    const x = c.x + 0.5, y = c.y + 0.5;
    this.anim(
      1100,
      (ctx, p) => {
        const a = p < 0.15 ? p / 0.15 : 1 - (p - 0.15) / 0.85;
        ctx.globalCompositeOperation = 'lighter';
        ctx.font = `700 0.55px ${FONT_DISPLAY}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = rgba(color, a * 0.35);
        ctx.fillText(label, x + 0.03, y - 0.6 - p * 0.8 + 0.03);
        ctx.fillStyle = rgba('#ffffff', a);
        ctx.fillText(label, x, y - 0.6 - p * 0.8);
      },
      delay,
    );
  }

  draw(ctx: CanvasRenderingContext2D, now: number, dt: number) {
    // Animationen
    this.anims = this.anims.filter((a) => {
      if (now < a.t0) return true;
      const p = (now - a.t0) / a.dur;
      if (p >= 1) return false;
      ctx.save();
      a.draw(ctx, p, now);
      ctx.restore();
      return true;
    });
    // Partikel
    if (!this.particles.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const alive: Particle[] = [];
    for (const p of this.particles) {
      p.life += dt;
      if (p.life >= p.max) continue;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vy *= k;
      if (p.kind === 'debris') p.vy += 3 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const a = 1 - p.life / p.max;
      if (p.kind === 'smoke') {
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = rgba(p.color, a * 0.5);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 + p.life), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'lighter';
      } else {
        ctx.fillStyle = rgba(p.color, a);
        const s = p.size * (p.kind === 'spark' ? 1 : 1.2);
        if (p.kind === 'spark') {
          ctx.strokeStyle = rgba(p.color, a);
          ctx.lineWidth = s;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
          ctx.stroke();
        } else ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      }
      alive.push(p);
    }
    this.particles = alive;
    ctx.restore();
  }
}
