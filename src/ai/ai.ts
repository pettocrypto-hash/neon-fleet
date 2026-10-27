import { FLEET, SHIP_LENGTH, type ShipKind, type SpecialId } from '../config/balance';
import { areaCells, idx, inBounds, N, randomLayout, shipCells } from '../game/board';
import { canHologram, canJump, shipAt } from '../game/fleet';
import { mulberry32, randInt, randomSeed } from '../game/rng';
import { specialBlock, specialCost } from '../game/rules';
import type { Cell, Dir } from '../game/types';
import { isShootable, viewAt, type EnemyView } from '../game/view';
import type { MatchController } from '../app/controller';

export type Difficulty = 'easy' | 'medium' | 'hard';

const DIRS: Cell[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/**
 * Computer-Gegner. Spielt über einen eigenen MatchController (gleiches Protokoll wie online).
 * leicht: Zufall mit gelegentlicher Jagd · mittel: Jagdmodus + Schachbrettmuster ·
 * schwer: Wahrscheinlichkeitskarte inkl. Radar-Infos, taktische Spezialaktionen.
 */
export class AiPlayer {
  private rng: () => number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsub: (() => void) | null = null;

  constructor(
    private ctrl: MatchController,
    readonly difficulty: Difficulty,
    private delayMs: [number, number] = [650, 1400],
    seed = randomSeed(),
  ) {
    this.rng = mulberry32(seed);
  }

  start() {
    this.unsub = this.ctrl.onChange(() => this.schedule());
    this.schedule();
  }

  stop() {
    this.unsub?.();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule() {
    if (this.timer) return;
    const c = this.ctrl.core;
    const needsSetup = c.phase === 'setup' && !c.myHash;
    const needsTurn = this.ctrl.myTurn && !this.ctrl.busy;
    const needsRematch = c.phase === 'over' && c.rematchOpp && !c.rematchMe;
    if (!needsSetup && !needsTurn && !needsRematch) return;
    const [a, b] = this.delayMs;
    const delay = needsSetup ? a : a + this.rng() * (b - a);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.act();
      this.schedule();
    }, delay);
  }

  private act() {
    const c = this.ctrl.core;
    if (c.phase === 'setup' && !c.myHash && c.config) {
      this.ctrl.submitLayout(randomLayout(this.rng, c.config.mode));
      return;
    }
    if (c.phase === 'over' && c.rematchOpp && !c.rematchMe) {
      this.ctrl.requestRematch();
      return;
    }
    if (!this.ctrl.myTurn || this.ctrl.busy) return;
    if (this.trySpecial()) return;
    this.fire();
  }

  // ---------------- Hilfen ----------------

  private can(id: SpecialId) {
    const m = this.ctrl.core.match!;
    return specialBlock(m, this.ctrl.me, id) === null;
  }

  private energy() {
    return this.ctrl.core.match!.energy[this.ctrl.me];
  }

  private chance(p: number) {
    return this.rng() < p;
  }

  private remainingKinds(view: EnemyView): ShipKind[] {
    const left = [...FLEET];
    for (const s of view.sunk) {
      const i = left.indexOf(s.kind);
      if (i >= 0) left.splice(i, 1);
    }
    return left;
  }

  /** Offene Treffer (nicht versenkt) und aufgedeckte Schiffsfelder. */
  private openHits(view: EnemyView) {
    const hits: Cell[] = [];
    const ships: Cell[] = [];
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const v = viewAt(view, { x, y });
        if (v === 'hit') hits.push({ x, y });
        else if (v === 'ship') ships.push({ x, y });
      }
    return { hits, ships };
  }

  /** Wahrscheinlichkeitskarte über alle möglichen Platzierungen der Restflotte. */
  private density(view: EnemyView, useRadar: boolean): number[] {
    const d = new Array(N * N).fill(0);
    const blocked = new Array(N * N).fill(false);
    for (let k = 0; k < N * N; k++) {
      const v = view.cells[k];
      blocked[k] = v === 'miss' || v === 'mine' || v === 'sunk' || v === 'empty';
    }
    if (useRadar) {
      const round = this.ctrl.core.match?.round ?? 0;
      for (const r of view.radar) {
        if (r.count === 0 && round - r.round < 10) {
          for (const c of areaCells(r, 3)) if (view.cells[idx(c.x, c.y)] === 'unknown') blocked[idx(c.x, c.y)] = true;
        }
      }
    }
    for (const kind of this.remainingKinds(view)) {
      const len = SHIP_LENGTH[kind];
      for (const dir of ['h', 'v'] as Dir[]) {
        for (let y = 0; y < N; y++)
          for (let x = 0; x < N; x++) {
            if (dir === 'h' ? x + len > N : y + len > N) continue;
            const cells = shipCells({ kind, x, y, dir });
            let ok = true;
            let hitCount = 0;
            for (const c of cells) {
              const k = idx(c.x, c.y);
              if (blocked[k]) {
                ok = false;
                break;
              }
              const v = view.cells[k];
              if (v === 'hit' || v === 'ship') hitCount++;
            }
            if (!ok) continue;
            const w = hitCount > 0 ? 1 + 25 * hitCount * hitCount : 1;
            for (const c of cells) d[idx(c.x, c.y)] += w;
          }
      }
    }
    if (useRadar) {
      for (const r of view.radar) {
        if (r.count > 0) for (const c of areaCells(r, 3)) d[idx(c.x, c.y)] *= 1 + 0.35 * r.count;
      }
    }
    return d;
  }

  private bestCell(view: EnemyView, score: number[]): Cell | null {
    let best: Cell | null = null;
    let bestScore = -1;
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const c = { x, y };
        if (!isShootable(view, c) || viewAt(view, c) === 'empty') continue;
        const s = score[idx(x, y)] + this.rng() * 0.5;
        if (s > bestScore) {
          bestScore = s;
          best = c;
        }
      }
    return best;
  }

  private randomShootable(view: EnemyView, parity = false): Cell | null {
    const free: Cell[] = [];
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const c = { x, y };
        if (!isShootable(view, c) || viewAt(view, c) === 'empty') continue;
        if (parity && (x + y) % 2 !== 0) continue;
        free.push(c);
      }
    if (!free.length) return parity ? this.randomShootable(view, false) : this.anyShootable(view);
    return free[randInt(this.rng, free.length)];
  }

  private anyShootable(view: EnemyView): Cell | null {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (isShootable(view, { x, y })) return { x, y };
    return null;
  }

  /** Jagdmodus: Linien verlängern oder Nachbarn der Treffer beschießen. */
  private huntTarget(view: EnemyView): Cell | null {
    const { hits, ships } = this.openHits(view);
    if (ships.length) return ships[randInt(this.rng, ships.length)];
    if (!hits.length) return null;
    const hitSet = new Set(hits.map((h) => idx(h.x, h.y)));
    const isHit = (x: number, y: number) => inBounds(x, y) && hitSet.has(idx(x, y));
    const ok = (x: number, y: number) => inBounds(x, y) && isShootable(view, { x, y }) && viewAt(view, { x, y }) !== 'empty';
    // Linien: zwei benachbarte Treffer → in beide Richtungen verlängern.
    const line: Cell[] = [];
    for (const h of hits)
      for (const d of [DIRS[0], DIRS[2]]) {
        if (!isHit(h.x + d.x, h.y + d.y)) continue;
        let fx = h.x, fy = h.y;
        while (isHit(fx + d.x, fy + d.y)) {
          fx += d.x;
          fy += d.y;
        }
        let bx = h.x, by = h.y;
        while (isHit(bx - d.x, by - d.y)) {
          bx -= d.x;
          by -= d.y;
        }
        if (ok(fx + d.x, fy + d.y)) line.push({ x: fx + d.x, y: fy + d.y });
        if (ok(bx - d.x, by - d.y)) line.push({ x: bx - d.x, y: by - d.y });
      }
    if (line.length) return line[randInt(this.rng, line.length)];
    const adj: Cell[] = [];
    for (const h of hits) for (const d of DIRS) if (ok(h.x + d.x, h.y + d.y)) adj.push({ x: h.x + d.x, y: h.y + d.y });
    return adj.length ? adj[randInt(this.rng, adj.length)] : null;
  }

  // ---------------- Spezialaktionen ----------------

  private trySpecial(): boolean {
    const c = this.ctrl.core;
    const m = c.match!;
    if (m.mode !== 'cyber' || m.specialsLeft <= 0 || m.empBlocked[this.ctrl.me]) return false;
    const f = c.fleet!;
    const diff = this.difficulty;
    const aggressiveness = diff === 'easy' ? 0.15 : diff === 'medium' ? 0.45 : 0.8;
    if (!this.chance(aggressiveness)) return false;
    const energy = this.energy();
    const reserve = diff === 'hard' ? 1 : 0;

    // 1) Defensive: Reparatur eines beschädigten Schiffs.
    const damaged = f.ships.filter((s) => !s.sunk && s.hits.some(Boolean));
    if (damaged.length && this.can('repair') && energy - specialCost(m, 'repair') >= reserve && this.chance(diff === 'hard' ? 0.7 : 0.4)) {
      const ship = damaged.sort((a, b) => SHIP_LENGTH[b.kind] - SHIP_LENGTH[a.kind])[0];
      const seg = ship.hits.findIndex(Boolean);
      const cell = shipCells(ship)[seg];
      if (this.ctrl.selfAction({ t: 'repair', c: cell }) === null) return true;
    }
    // 2) Schild auf das größte beschädigte bzw. bekannte Schiff.
    if (this.can('shield') && energy - specialCost(m, 'shield') >= reserve && this.chance(0.5)) {
      const exposed = f.ships.filter((s) => !s.sunk && !s.shield && (s.hits.some(Boolean) || shipCells(s).some((sc) => f.known[idx(sc.x, sc.y)])));
      const target = exposed.sort((a, b) => SHIP_LENGTH[b.kind] - SHIP_LENGTH[a.kind])[0];
      if (target && this.ctrl.selfAction({ t: 'shield', shipId: target.id }) === null) return true;
    }
    // 3) Sprung: unbeschädigtes, aber entdecktes Schiff in Sicherheit bringen (schwer).
    if (diff === 'hard' && this.can('jump')) {
      const spotted = f.ships.find((s) => !s.sunk && !s.hits.some(Boolean) && shipCells(s).some((sc) => f.known[idx(sc.x, sc.y)]));
      if (spotted) {
        for (let t = 0; t < 300; t++) {
          const dir: Dir = this.chance(0.5) ? 'h' : 'v';
          const x = randInt(this.rng, N), y = randInt(this.rng, N);
          if (canJump(f, spotted.id, x, y, dir)) {
            if (this.ctrl.selfAction({ t: 'jump', shipId: spotted.id, x, y, dir }) === null) return true;
            break;
          }
        }
      }
    }
    // 4) Hologramm früh im Spiel.
    if (this.can('hologram') && m.round >= 2 && this.chance(diff === 'easy' ? 0.2 : 0.5)) {
      for (let t = 0; t < 100; t++) {
        const cell = { x: randInt(this.rng, N), y: randInt(this.rng, N) };
        if (canHologram(f, cell) && !this.nearOwnShip(cell)) {
          if (this.ctrl.selfAction({ t: 'hologram', c: cell }) === null) return true;
          break;
        }
      }
    }
    const view = c.view;
    const hunting = this.openHits(view).hits.length > 0;
    // 5) EMP, wenn der Gegner viel Energie hat.
    if (this.can('emp') && m.energy[this.ctrl.opp] >= 5 && this.chance(diff === 'hard' ? 0.5 : 0.25)) {
      const center = this.bestCell(view, this.density(view, true)) ?? { x: 7, y: 7 };
      if (this.ctrl.attack({ t: 'emp', c: center }) === null) return true;
    }
    // 6) Radar, wenn nichts zu jagen ist.
    if (!hunting && this.can('radar') && energy - specialCost(m, 'radar') >= reserve && this.chance(0.6)) {
      const center = diff === 'hard' ? this.radarCenter(view) : { x: 1 + randInt(this.rng, N - 2), y: 1 + randInt(this.rng, N - 2) };
      if (this.ctrl.attack({ t: 'radar', c: center }) === null) return true;
    }
    // 7) Drohne auf die heißeste Zelle (schwer).
    if (diff === 'hard' && !hunting && this.can('drone') && energy >= 6) {
      const cell = this.bestCell(view, this.density(view, true));
      if (cell && this.ctrl.attack({ t: 'drone', c: cell }) === null) return true;
    }
    return false;
  }

  private nearOwnShip(c: Cell): boolean {
    const f = this.ctrl.core.fleet!;
    return areaCells(c, 3).some((a) => shipAt(f, a));
  }

  private radarCenter(view: EnemyView): Cell {
    const d = this.density(view, true);
    let best = { x: 7, y: 7 };
    let bestScore = -1;
    for (let y = 1; y < N - 1; y++)
      for (let x = 1; x < N - 1; x++) {
        let s = 0;
        let unknown = 0;
        for (const c of areaCells({ x, y }, 3)) {
          s += d[idx(c.x, c.y)];
          if (viewAt(view, c) === 'unknown') unknown++;
        }
        if (unknown < 7) continue;
        if (view.radar.some((r) => Math.abs(r.x - x) < 3 && Math.abs(r.y - y) < 3)) continue;
        s += this.rng();
        if (s > bestScore) {
          bestScore = s;
          best = { x, y };
        }
      }
    return best;
  }

  // ---------------- Schießen ----------------

  private fire() {
    const view = this.ctrl.core.view;
    const diff = this.difficulty;
    let target: Cell | null = null;
    if (diff === 'easy') {
      target = this.chance(0.55) ? this.huntTarget(view) : null;
      target ??= this.randomShootable(view);
    } else if (diff === 'medium') {
      target = this.huntTarget(view) ?? this.randomShootable(view, true);
    } else {
      const { ships } = this.openHits(view);
      target = ships.length ? ships[0] : this.bestCell(view, this.density(view, true));
    }
    if (!target) target = this.anyShootable(view);
    if (!target) return;

    // Salve entlang einer Trefferlinie bzw. quer durch heiße Zonen.
    if (diff !== 'easy' && this.can('salvo') && this.chance(diff === 'hard' ? 0.65 : 0.35)) {
      const dir = this.salvoDir(view, target);
      if (this.ctrl.attack({ t: 'salvo', c: target, dir }) === null) return;
    }
    if (this.ctrl.attack({ t: 'shot', c: target }) !== null) {
      const fallback = this.anyShootable(view);
      if (fallback) this.ctrl.attack({ t: 'shot', c: fallback });
    }
  }

  private salvoDir(view: EnemyView, c: Cell): Dir {
    const hitAt = (x: number, y: number) => inBounds(x, y) && viewAt(view, { x, y }) === 'hit';
    if (hitAt(c.x - 1, c.y) || hitAt(c.x + 1, c.y)) return 'h';
    if (hitAt(c.x, c.y - 1) || hitAt(c.x, c.y + 1)) return 'v';
    return this.chance(0.5) ? 'h' : 'v';
  }
}
