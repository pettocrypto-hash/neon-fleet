import { audio } from '../audio/audio';
import type { GameSession } from '../app/game-session';
import { vibrate } from '../app/settings';
import { FLEET, SHIP_LENGTH, type ShipKind } from '../config/balance';
import { canPlace, idx, minesForMode, N, randomMines, randomShips, sameCell, shipCells } from '../game/board';
import { mulberry32, randomSeed } from '../game/rng';
import type { Cell, Dir, ShipPlacement } from '../game/types';
import { t, type I18nKey } from '../i18n';
import { BoardView, type WorldPt } from '../render/board-view';
import { drawShip, renderShipPreview } from '../render/ships';
import { C, rgba } from '../render/theme';
import { button, h } from './dom';
import type { PhaseView } from './game-screen';
import { icon } from './icons';
import { muteButton } from './menus';

interface Drag {
  id: number;
  kind: ShipKind;
  dir: Dir;
  /** Gegriffenes Segment. */
  grab: number;
  world: WorldPt | null;
  fromBoard: boolean;
  startWorld: WorldPt | null;
  moved: boolean;
  touch: boolean;
}

/** Flotte platzieren: Drag & Drop (Touch), Drehen per Tippen, Zufall, Minen, Bereit. */
export class SetupView implements PhaseView {
  el: HTMLElement;
  private board: BoardView;
  private ships: ShipPlacement[] = [];
  private mines: Cell[] = [];
  private selected: number | null = null;
  private mineMode = false;
  private drag: Drag | null = null;
  private dock: HTMLElement;
  private readyBtn: HTMLButtonElement;
  private mineBtn: HTMLButtonElement;
  private hint: HTMLElement;
  private timer: HTMLElement;
  private waiting: HTMLElement;
  private oppState: HTMLElement;
  private rng = mulberry32(randomSeed());
  private dockDir: Dir = 'h';
  private floating: HTMLElement | null = null;

  constructor(private s: GameSession) {
    const ctrl = s.ctrl;
    this.timer = h('span', { class: 'chip timer' }, '--');
    this.oppState = h('span', { class: 'chip' }, '');
    const boardHost = h('div', { class: 'board-host' });
    this.dock = h('div', { class: 'dock' });
    this.hint = h('p', { class: 'hint' }, t('setup.hint'));
    this.mineBtn = button('', () => this.toggleMines(), 'tool');
    this.readyBtn = button(t('setup.ready'), () => this.ready(), 'primary ready');
    this.waiting = h('div', { class: 'waiting-overlay hidden' }, h('div', { class: 'panel' }, h('h3', null, t('setup.waitingOpp')), h('div', { class: 'loader' }, h('i'), h('i'), h('i'))));

    this.el = h(
      'div',
      { class: 'setup' },
      h('header', { class: 'topbar' }, h('h2', { class: 'topbar-title' }, t('setup.title')), this.oppState, this.timer, muteButton()),
      h('div', { class: 'board-frame' }, boardHost, this.waiting),
      this.hint,
      this.dock,
      h(
        'div',
        { class: 'toolbar' },
        button(h('span', { html: icon('rotate', 18) + ' ' + t('setup.rotate') }), () => this.rotateSelected(), 'tool'),
        button(t('setup.random'), () => this.randomize(), 'tool'),
        button(t('setup.clear'), () => this.clearAll(), 'tool'),
        this.mineBtn,
      ),
      this.readyBtn,
    );

    this.board = new BoardView(boardHost, { labels: true });
    this.board.painters.push((ctx, now) => this.paint(ctx, now));
    this.board.input = {
      onTap: (c) => this.tap(c),
      onDragStart: (c, w) => this.startBoardDrag(c, w),
      onDragMove: (w) => this.moveDrag(w),
      onDragEnd: (w, inside) => this.endDrag(w, inside),
    };
    void ctrl;
    this.renderDock();
  }

  private get mode() {
    return this.s.ctrl.core.config?.mode ?? 'cyber';
  }
  private get maxMines() {
    return minesForMode(this.mode);
  }
  private get locked() {
    return !!this.s.ctrl.core.myHash || !this.s.ctrl.core.config;
  }

  // ---------- Darstellung ----------

  private paint(ctx: CanvasRenderingContext2D, now: number) {
    for (const m of this.mines) {
      ctx.strokeStyle = C.yellow;
      ctx.fillStyle = rgba(C.yellow, 0.15);
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      ctx.moveTo(m.x + 0.5, m.y + 0.2);
      ctx.lineTo(m.x + 0.8, m.y + 0.74);
      ctx.lineTo(m.x + 0.2, m.y + 0.74);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    for (const sh of this.ships) {
      if (this.drag?.fromBoard && this.drag.id === sh.id && this.drag.moved) continue;
      drawShip(ctx, sh.kind, sh.x, sh.y, sh.dir, now, { selected: this.selected === sh.id });
    }
    const g = this.ghost();
    if (g) {
      const valid = canPlace(this.ships, this.mines, g);
      // Zielzellen markieren
      for (const c of shipCells(g)) {
        if (c.x < 0 || c.y < 0 || c.x >= N || c.y >= N) continue;
        ctx.fillStyle = rgba(valid ? C.cyan : C.red, 0.16);
        ctx.fillRect(c.x, c.y, 1, 1);
      }
      drawShip(ctx, g.kind, g.x, g.y, g.dir, now, { ghost: true, invalid: !valid });
    }
  }

  private ghost(): ShipPlacement | null {
    const d = this.drag;
    if (!d || !d.world || (d.fromBoard && !d.moved)) return null;
    const L = SHIP_LENGTH[d.kind];
    // Bei Touch das Schiff leicht über dem Finger zeigen.
    const wy = d.world.y - (d.touch && !d.fromBoard ? 0.9 : 0);
    const gx = Math.floor(d.world.x), gy = Math.floor(wy);
    const grab = Math.min(d.grab, L - 1);
    const x = d.dir === 'h' ? gx - grab : gx;
    const y = d.dir === 'v' ? gy - grab : gy;
    return { id: d.id, kind: d.kind, x, y, dir: d.dir };
  }

  private renderDock() {
    const placedIds = new Set(this.ships.map((s) => s.id));
    const items: HTMLElement[] = [];
    FLEET.forEach((kind, id) => {
      if (placedIds.has(id)) return;
      const cv = h('canvas', { class: 'dock-ship' });
      renderShipPreview(cv, kind);
      const item = h('div', { class: 'dock-item', 'data-id': id, title: t(`ship.${kind}` as I18nKey) }, cv, h('span', null, `${t(`ship.${kind}` as I18nKey)} · ${SHIP_LENGTH[kind]}`));
      item.addEventListener('pointerdown', (e) => this.startDockDrag(e, id, kind));
      items.push(item);
    });
    this.dock.replaceChildren(...items);
    this.dock.classList.toggle('empty', items.length === 0);
    this.updateButtons();
  }

  private updateButtons() {
    const missingShips = FLEET.length - this.ships.length;
    const missingMines = this.maxMines - this.mines.length;
    this.mineBtn.textContent = t('setup.mines', { n: this.mines.length, max: this.maxMines });
    this.mineBtn.classList.toggle('active', this.mineMode);
    this.mineBtn.classList.toggle('hidden', this.maxMines === 0);
    this.readyBtn.disabled = missingShips > 0 || missingMines > 0 || this.locked;
    if (this.mineMode) this.hint.textContent = t('setup.minesHint');
    else if (missingShips > 0) this.hint.textContent = t('setup.missing', { n: missingShips });
    else if (missingMines > 0) this.hint.textContent = t('setup.missingMines', { n: missingMines });
    else this.hint.textContent = t('setup.hint');
  }

  update() {
    const c = this.s.ctrl.core;
    this.waiting.classList.toggle('hidden', !c.myHash && !!c.config);
    if (!c.config) {
      this.waiting.classList.remove('hidden');
    }
    this.oppState.textContent = c.oppHash ? t('setup.oppReady') : c.oppName || t('common.opponent');
    this.oppState.classList.toggle('good', !!c.oppHash);
    this.updateButtons();
    this.tick();
  }

  tick() {
    const c = this.s.ctrl.core;
    if (!c.setupDeadline || c.myHash) {
      this.timer.textContent = c.myHash ? '✓' : '--';
      return;
    }
    if (Date.now() > c.setupDeadline - 400) {
      // Zeit abgelaufen: angefangene Aufstellung zufällig vervollständigen und bestätigen.
      if (this.drag) this.drag = null;
      this.ships = randomShips(this.rng, this.ships);
      this.mines = randomMines(this.rng, this.ships, this.maxMines, this.mines.filter((m) => !this.shipAtCell(m)).slice(0, this.maxMines));
      this.renderDock();
      this.ready();
      return;
    }
    const sec = Math.max(0, Math.ceil((c.setupDeadline - Date.now()) / 1000));
    this.timer.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    this.timer.classList.toggle('warn', sec <= 15);
  }

  destroy() {
    this.board.destroy();
    this.floating?.remove();
    window.removeEventListener('pointermove', this.winMove);
    window.removeEventListener('pointerup', this.winUp);
    window.removeEventListener('pointercancel', this.winUp);
  }

  // ---------- Eingabe ----------

  private shipAtCell(c: Cell) {
    return this.ships.find((s) => shipCells(s).some((sc) => sameCell(sc, c))) ?? null;
  }

  private tap(c: Cell) {
    if (this.locked) return;
    const mineIdx = this.mines.findIndex((m) => sameCell(m, c));
    if (mineIdx >= 0) {
      this.mines.splice(mineIdx, 1);
      audio.play('click');
      this.updateButtons();
      return;
    }
    if (this.mineMode && !this.shipAtCell(c)) {
      if (this.mines.length >= this.maxMines) {
        audio.play('error');
        return;
      }
      this.mines.push(c);
      audio.play('place');
      vibrate(12);
      if (this.mines.length >= this.maxMines) this.mineMode = false;
      this.updateButtons();
    }
  }

  private startBoardDrag(c: Cell, w: WorldPt): boolean {
    if (this.locked || this.mineMode) return false;
    const ship = this.shipAtCell(c);
    if (!ship) return false;
    const grab = shipCells(ship).findIndex((sc) => sameCell(sc, c));
    this.selected = ship.id;
    this.drag = { id: ship.id, kind: ship.kind, dir: ship.dir, grab, world: w, fromBoard: true, startWorld: w, moved: false, touch: false };
    audio.play('select');
    return true;
  }

  private moveDrag(w: WorldPt) {
    const d = this.drag;
    if (!d) return;
    d.world = w;
    if (d.startWorld && Math.hypot(w.x - d.startWorld.x, w.y - d.startWorld.y) > 0.35) d.moved = true;
  }

  private endDrag(w: WorldPt, inside: boolean) {
    const d = this.drag;
    if (!d) return;
    d.world = w;
    if (d.fromBoard && !d.moved) {
      // Tippen auf Schiff = drehen
      this.drag = null;
      this.rotate(d.id, d.grab);
      return;
    }
    const g = this.ghost();
    this.drag = null;
    if (inside && g && canPlace(this.ships, this.mines, g)) {
      this.ships = this.ships.filter((s) => s.id !== g.id).concat(g);
      this.selected = g.id;
      audio.play('place');
      vibrate(15);
    } else if (!inside && d.fromBoard) {
      // Vom Brett gezogen → zurück ins Dock
      this.ships = this.ships.filter((s) => s.id !== d.id);
      this.selected = null;
      audio.play('click');
    } else {
      audio.play('error');
    }
    this.renderDock();
  }

  private startDockDrag(e: PointerEvent, id: number, kind: ShipKind) {
    if (this.locked) return;
    e.preventDefault();
    this.mineMode = false;
    const L = SHIP_LENGTH[kind];
    this.drag = { id, kind, dir: this.dockDir, grab: Math.floor(L / 2), world: null, fromBoard: false, startWorld: null, moved: true, touch: e.pointerType === 'touch' };
    this.floating = h('div', { class: 'drag-float' });
    const cv = h('canvas');
    renderShipPreview(cv, kind);
    this.floating.appendChild(cv);
    document.body.appendChild(this.floating);
    this.positionFloat(e.clientX, e.clientY);
    audio.play('select');
    window.addEventListener('pointermove', this.winMove);
    window.addEventListener('pointerup', this.winUp);
    window.addEventListener('pointercancel', this.winUp);
  }

  private positionFloat(x: number, y: number) {
    if (!this.floating || !this.drag) return;
    const w = this.board.clientToWorld(x, y);
    const over = !!this.board.cellAt({ x: w.x, y: w.y - (this.drag.touch ? 0.9 : 0) });
    this.floating.style.transform = `translate(${x}px, ${y - (this.drag.touch ? 40 : 0)}px) translate(-50%, -50%)`;
    this.floating.classList.toggle('over', over);
    this.drag.world = over ? w : null;
  }

  private winMove = (e: PointerEvent) => this.positionFloat(e.clientX, e.clientY);

  private winUp = (e: PointerEvent) => {
    window.removeEventListener('pointermove', this.winMove);
    window.removeEventListener('pointerup', this.winUp);
    window.removeEventListener('pointercancel', this.winUp);
    this.positionFloat(e.clientX, e.clientY);
    this.floating?.remove();
    this.floating = null;
    const d = this.drag;
    if (!d) return;
    if (e.type === 'pointercancel' || !d.world) {
      this.drag = null;
      return;
    }
    this.endDrag(d.world, true);
  };

  private rotate(id: number, pivot = 0) {
    const s = this.ships.find((sh) => sh.id === id);
    if (!s || this.locked) return;
    const cells = shipCells(s);
    const p = cells[Math.min(pivot, cells.length - 1)];
    const dir: Dir = s.dir === 'h' ? 'v' : 'h';
    const L = SHIP_LENGTH[s.kind];
    const others = this.ships.filter((o) => o.id !== id);
    // Um das angetippte Segment drehen, sonst verschieben, bis es passt.
    const candidates: { x: number; y: number }[] = [];
    const base = dir === 'v' ? { x: p.x, y: p.y - pivot } : { x: p.x - pivot, y: p.y };
    candidates.push(base);
    for (let off = 1; off < L; off++) {
      candidates.push(dir === 'v' ? { x: base.x, y: base.y - off } : { x: base.x - off, y: base.y });
      candidates.push(dir === 'v' ? { x: base.x, y: base.y + off } : { x: base.x + off, y: base.y });
    }
    candidates.push({ x: s.x, y: s.y });
    for (const c of candidates) {
      const np = { ...s, x: c.x, y: c.y, dir };
      if (canPlace(others, this.mines, np)) {
        Object.assign(s, np);
        this.selected = id;
        audio.play('place');
        vibrate(10);
        return;
      }
    }
    audio.play('error');
    vibrate([20, 30, 20]);
  }

  private rotateSelected() {
    if (this.selected !== null && this.ships.some((s) => s.id === this.selected)) this.rotate(this.selected);
    else {
      this.dockDir = this.dockDir === 'h' ? 'v' : 'h';
      audio.play('select');
    }
  }

  private randomize() {
    if (this.locked) return;
    this.ships = randomShips(this.rng);
    this.mines = randomMines(this.rng, this.ships, this.maxMines);
    this.selected = null;
    this.mineMode = false;
    audio.play('place');
    this.board.fx.pulseArea(this.ships.flatMap((s) => shipCells(s)), C.cyan, 600);
    this.renderDock();
  }

  private clearAll() {
    if (this.locked) return;
    this.ships = [];
    this.mines = [];
    this.selected = null;
    this.renderDock();
  }

  private toggleMines() {
    if (this.locked) return;
    this.mineMode = !this.mineMode;
    this.selected = null;
    this.updateButtons();
  }

  private ready() {
    if (this.readyBtn.disabled) return;
    const occ = new Set(this.ships.flatMap((s) => shipCells(s)).map((c) => idx(c.x, c.y)));
    if (this.mines.some((m) => occ.has(idx(m.x, m.y)))) return;
    this.s.ctrl.submitLayout({ ships: [...this.ships].sort((a, b) => a.id - b.id), mines: this.mines });
    audio.play('combo');
    vibrate([20, 40, 60]);
    this.board.fx.pulseArea(this.ships.flatMap((s) => shipCells(s)), C.green, 900);
    this.update();
  }
}
