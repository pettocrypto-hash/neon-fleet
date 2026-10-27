import { audio, type Sfx } from '../audio/audio';
import type { AttackAction, Fx, SelfRequest } from '../app/controller';
import type { GameSession } from '../app/game-session';
import { vibrate } from '../app/settings';
import { BALANCE, FLEET, SHIP_LENGTH, SPECIAL_ORDER, SPECIALS, type SpecialId } from '../config/balance';
import { areaCells, cellName, idx, salvoCells, shipCells, sameCell } from '../game/board';
import { shipAt } from '../game/fleet';
import { specialBlock, specialCost } from '../game/rules';
import type { Cell, Dir, LogEntry, ShotOutcome } from '../game/types';
import { isShootable, viewAt } from '../game/view';
import { t, type I18nKey } from '../i18n';
import { BoardView } from '../render/board-view';
import { paintCrosshair, paintEnemy, paintOwn, SunkClock } from '../render/scene';
import { drawShip } from '../render/ships';
import { C, rgba } from '../render/theme';
import { button, confirmDialog, flash, glitchScreen, h, toast } from './dom';
import type { PhaseView } from './game-screen';
import { icon } from './icons';
import { muteButton } from './menus';

type Mode = 'shot' | SpecialId;

const LAND_MS = 280;

/** Kampfansicht: Gegnerfeld im Fokus, eigene Flotte als Minimap, HUD und Aktionsleiste. */
export class BattleView implements PhaseView {
  el: HTMLElement;
  private enemy: BoardView;
  private own: BoardView;
  private enemyHost = h('div', { class: 'board-host' });
  private ownHost = h('div', { class: 'board-host' });
  private mainSlot = h('div', { class: 'board-frame main' });
  private miniSlot = h('div', { class: 'minimap' });
  private mainIsEnemy = true;
  private mode: Mode = 'shot';
  private target: Cell | null = null;
  private salvoDir: Dir = 'h';
  private selShip: number | null = null;
  private jumpDir: Dir = 'h';
  private sunkEnemy = new SunkClock();
  private sunkOwn = new SunkClock();
  private holdEnemy = new Map<number, number>();
  private holdOwn = new Map<number, number>();
  private lastTurnActive: number | null = null;
  private lastEnergy = -1;

  // HUD-Elemente
  private roundChip = h('span', { class: 'chip' });
  private eventChip = h('span', { class: 'chip event hidden' });
  private turnLabel = h('div', { class: 'turn-label' });
  private timerFill = h('div', { class: 'timer-fill' });
  private timerBar = h('div', { class: 'timer-bar' }, this.timerFill);
  private energyMe = h('div', { class: 'energy-bar' });
  private energyMeNum = h('span', { class: 'energy-num' });
  private energyOpp = h('div', { class: 'energy-bar small' });
  private energyOppNum = h('span', { class: 'energy-num small' });
  private fleetEnemy = h('div', { class: 'pips' });
  private fleetMine = h('div', { class: 'pips mine' });
  private mainTag = h('div', { class: 'board-tag' });
  private miniTag = h('div', { class: 'mini-tag' });
  private blackout = h('div', { class: 'blackout hidden' }, t('battle.blackout'));
  private banner = h('div', { class: 'banner' });
  private ticker = h('div', { class: 'ticker' });
  private hint = h('div', { class: 'hint battle-hint' });
  private specialBtns = new Map<SpecialId, HTMLButtonElement>();
  private fireBtn: HTMLButtonElement;
  private rotBtn: HTMLButtonElement;
  private cancelBtn: HTMLButtonElement;
  private actionsRow: HTMLElement;
  private logPanel: HTMLElement;
  private oppName = h('span', { class: 'opp-name' });
  private offFx: () => void;

  constructor(private s: GameSession) {
    const ctrl = s.ctrl;
    const cyber = ctrl.core.config?.mode === 'cyber';

    this.fireBtn = button(h('span', { html: `${icon('fire', 20)}<b>${t('battle.fire')}</b>` }), () => this.execute(), 'fire');
    this.rotBtn = button(h('span', { html: icon('rotate', 18) }), () => this.rotate(), 'tool square', { 'aria-label': t('battle.rotate') });
    this.cancelBtn = button(t('battle.cancel'), () => this.setMode('shot'), 'tool ghost');

    const grid = h('div', { class: 'specials' });
    for (const id of SPECIAL_ORDER) {
      const b = h(
        'button',
        { class: 'special', type: 'button', title: t(`specialDesc.${id}` as I18nKey) },
        h('span', { class: 'sp-ico', html: icon(id, 20) }),
        h('span', { class: 'sp-name' }, t(`special.${id}` as I18nKey)),
        h('span', { class: 'sp-cost' }),
        h('span', { class: 'sp-lock' }),
      );
      b.addEventListener('click', () => this.pickSpecial(id));
      this.specialBtns.set(id, b);
      grid.appendChild(b);
    }
    this.actionsRow = h('div', { class: 'fire-row' }, this.rotBtn, this.cancelBtn, this.fireBtn);

    this.logPanel = h('div', { class: 'log-panel hidden' });
    this.logPanel.addEventListener('click', () => this.logPanel.classList.add('hidden'));
    this.ticker.addEventListener('click', () => {
      this.renderLog(true);
      this.logPanel.classList.toggle('hidden');
    });

    const forfeitBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('battle.forfeit'), html: icon('flag') });
    forfeitBtn.addEventListener('click', async () => {
      audio.play('click');
      if (await confirmDialog(t('battle.forfeitConfirm'), t('battle.forfeit'), t('common.cancel'))) ctrl.forfeit();
    });

    this.mainSlot.append(this.mainTag, this.banner);
    this.miniSlot.append(this.miniTag, this.blackout);
    this.miniSlot.addEventListener('click', (e) => {
      if (e.target === this.miniSlot || e.target === this.miniTag) this.swap();
    });

    this.el = h(
      'div',
      { class: `battle ${cyber ? 'cyber' : 'classic'}` },
      h(
        'header',
        { class: 'hud' },
        h('div', { class: 'hud-left' }, this.roundChip, this.eventChip),
        h('div', { class: 'hud-center' }, this.turnLabel, this.timerBar),
        h('div', { class: 'hud-right' }, muteButton(), forfeitBtn),
      ),
      cyber
        ? h(
            'div',
            { class: 'energy-row' },
            h('div', { class: 'energy me' }, h('span', { class: 'lbl' }, t('battle.energy')), this.energyMe, this.energyMeNum),
            h('div', { class: 'energy opp' }, this.oppName, this.energyOpp, this.energyOppNum),
          )
        : h('div', { class: 'energy-row' }, h('span', { class: 'lbl' }, t('common.you')), h('span', { class: 'spacer' }), this.oppName),
      h('div', { class: 'fleet-row' }, this.fleetMine, this.fleetEnemy),
      this.mainSlot,
      h('div', { class: 'info-row' }, h('div', { class: 'info-left' }, this.hint, this.ticker), this.miniSlot),
      cyber ? grid : null,
      this.actionsRow,
      this.logPanel,
    );

    this.mainSlot.insertBefore(this.enemyHost, this.mainTag);
    this.miniSlot.insertBefore(this.ownHost, this.miniTag);
    this.enemy = new BoardView(this.enemyHost, { labels: true });
    this.own = new BoardView(this.ownHost, { labels: false, zoomable: false });
    this.enemy.tint = C.pink;
    this.own.tint = C.cyan;

    this.enemy.painters.push((ctx, now) => {
      const c = ctrl.core;
      paintEnemy(ctx, now, { view: c.view, sunk: this.sunkEnemy, round: c.match?.round ?? 0, hold: this.holdEnemy, reveal: null });
    });
    this.enemy.overlays.push((ctx, now) => {
      if (!this.mainIsEnemy || !ctrl.myTurn || !this.target || this.isOwnMode()) return;
      paintCrosshair(ctx, now, this.targetCells(), this.mode === 'shot' ? C.pink : C.yellow, this.isValid());
    });
    this.own.painters.push((ctx, now) => {
      const c = ctrl.core;
      if (!c.fleet) return;
      const hide = c.match?.event === 'blackout';
      paintOwn(ctx, now, {
        fleet: c.fleet,
        sunk: this.sunkOwn,
        empArea: c.empOnMe,
        hold: this.holdOwn,
        hideShips: hide,
        selectable: !this.mainIsEnemy ? (id) => this.shipSelectable(id) : undefined,
        selectedShip: this.selShip,
      });
    });
    this.own.overlays.push((ctx, now) => this.paintOwnOverlay(ctx, now));

    this.enemy.input = { onTap: (c) => this.tapEnemy(c) };
    this.own.input = { onTap: (c) => this.tapOwn(c) };
    this.offFx = ctrl.onFx((f) => this.onFx(f));
    this.restoreSunkClocks();
  }

  private restoreSunkClocks() {
    // Bereits versenkte Schiffe (z. B. nach Reconnect) ohne Animation zeigen.
    const c = this.s.ctrl.core;
    for (const sh of c.view.sunk) this.sunkEnemy.mark(sh, 0);
    for (const sh of c.fleet?.ships ?? []) if (sh.sunk) this.sunkOwn.mark(sh, 0);
  }

  destroy() {
    this.offFx();
    this.enemy.destroy();
    this.own.destroy();
  }

  // ---------- Zustand / Validierung ----------

  private isOwnMode(m: Mode = this.mode) {
    return m !== 'shot' && SPECIALS[m].target === 'own';
  }

  private targetCells(): Cell[] {
    const tg = this.target;
    if (!tg) return [];
    switch (this.mode) {
      case 'salvo':
        return salvoCells(tg, this.salvoDir);
      case 'radar':
        return areaCells(tg, BALANCE.radarSize);
      case 'emp':
        return areaCells(tg, BALANCE.empSize);
      default:
        return [tg];
    }
  }

  private jumpRequest(): SelfRequest | null {
    if (this.selShip === null || !this.target) return null;
    return { t: 'jump', shipId: this.selShip, x: this.target.x, y: this.target.y, dir: this.jumpDir };
  }

  private selfRequest(): SelfRequest | null {
    switch (this.mode) {
      case 'shield':
        return this.selShip !== null ? { t: 'shield', shipId: this.selShip } : null;
      case 'repair':
        return this.target ? { t: 'repair', c: this.target } : null;
      case 'hologram':
        return this.target ? { t: 'hologram', c: this.target } : null;
      case 'jump':
        return this.jumpRequest();
      default:
        return null;
    }
  }

  private attackAction(): AttackAction | null {
    const tg = this.target;
    if (!tg) return null;
    switch (this.mode) {
      case 'shot':
        return { t: 'shot', c: tg };
      case 'salvo':
        return { t: 'salvo', c: tg, dir: this.salvoDir };
      case 'radar':
        return { t: 'radar', c: tg };
      case 'drone':
        return { t: 'drone', c: tg };
      case 'emp':
        return { t: 'emp', c: tg };
      default:
        return null;
    }
  }

  private isValid(): boolean {
    const ctrl = this.s.ctrl;
    const v = ctrl.core.view;
    if (!ctrl.myTurn || ctrl.busy) return false;
    if (this.isOwnMode()) {
      const r = this.selfRequest();
      return !!r && ctrl.canSelf(r);
    }
    const tg = this.target;
    if (!tg) return false;
    switch (this.mode) {
      case 'shot':
        return isShootable(v, tg);
      case 'salvo':
        return salvoCells(tg, this.salvoDir).some((c) => isShootable(v, c));
      case 'drone':
        return viewAt(v, tg) === 'unknown';
      default:
        return true;
    }
  }

  private shipSelectable(id: number): boolean {
    const f = this.s.ctrl.core.fleet;
    const sh = f?.ships.find((x) => x.id === id);
    if (!sh || sh.sunk) return false;
    if (this.mode === 'shield') return !sh.shield;
    if (this.mode === 'jump') return !sh.hits.some(Boolean);
    if (this.mode === 'repair') return sh.hits.some(Boolean);
    return false;
  }

  /** Sperrgrund für die UI (inkl. Blackout bei eigenen Aktionen). */
  private block(id: SpecialId): string | null {
    const m = this.s.ctrl.core.match;
    if (!m) return '';
    const b = specialBlock(m, this.s.ctrl.me, id);
    if (b) return b;
    if (SPECIALS[id].target === 'own' && m.event === 'blackout') return 'blackout';
    return null;
  }

  // ---------- Eingabe ----------

  private pickSpecial(id: SpecialId) {
    const b = this.block(id);
    if (b !== null) {
      audio.play('error');
      vibrate([15, 30, 15]);
      if (b === 'energy') toast(`${t(`special.${id}` as I18nKey)}: ${specialCost(this.s.ctrl.core.match!, id)} ${t('battle.energy')}`, 'warn', 1400);
      else if (b === 'emp') toast(t('battle.empBlocked'), 'warn', 1400);
      else if (b === 'blackout') toast(t('event.blackoutDesc'), 'warn', 1400);
      else if (b === 'limit') toast(t('block.limit'), 'warn', 1400);
      else if (b === 'slot') toast(t('block.slot'), 'warn', 1400);
      return;
    }
    audio.play('select');
    vibrate(8);
    this.setMode(this.mode === id ? 'shot' : id);
    if (this.mode !== 'shot') toast(t(`specialDesc.${id}` as I18nKey), 'info', 1600);
  }

  private setMode(m: Mode) {
    const wasOwn = this.isOwnMode();
    this.mode = m;
    this.selShip = null;
    if (this.isOwnMode()) this.target = null;
    else if (wasOwn) this.target = null;
    const wantEnemy = !this.isOwnMode();
    if (wantEnemy !== this.mainIsEnemy) this.swap(false);
    this.update();
  }

  private swap(sound = true) {
    this.mainIsEnemy = !this.mainIsEnemy;
    const [main, mini] = this.mainIsEnemy ? [this.enemyHost, this.ownHost] : [this.ownHost, this.enemyHost];
    this.mainSlot.insertBefore(main, this.mainTag);
    this.miniSlot.insertBefore(mini, this.miniTag);
    const mainBV = this.mainIsEnemy ? this.enemy : this.own;
    const miniBV = this.mainIsEnemy ? this.own : this.enemy;
    mainBV.opts.zoomable = true;
    miniBV.opts.zoomable = false;
    mainBV.setLabels(true);
    miniBV.setLabels(false);
    if (sound) audio.play('select');
    if (!this.mainIsEnemy && !this.isOwnMode() && this.mode !== 'shot') this.mode = 'shot';
    this.update();
  }

  private tapEnemy(c: Cell) {
    if (!this.mainIsEnemy) return this.swap();
    const ctrl = this.s.ctrl;
    if (!ctrl.myTurn || this.isOwnMode()) return;
    if (this.mode === 'shot' && !isShootable(ctrl.core.view, c)) {
      audio.play('error');
      toast(t('battle.alreadyShot'), 'warn', 1000);
      return;
    }
    // Zweites Tippen auf dasselbe Feld = Ausrichtung der Salve drehen
    if (this.mode === 'salvo' && this.target && sameCell(this.target, c)) this.salvoDir = this.salvoDir === 'h' ? 'v' : 'h';
    this.target = c;
    this.enemy.focus = c;
    audio.play('select');
    vibrate(6);
    this.update();
  }

  private tapOwn(c: Cell) {
    if (this.mainIsEnemy) return this.swap();
    const ctrl = this.s.ctrl;
    const f = ctrl.core.fleet;
    if (!f || !ctrl.myTurn || !this.isOwnMode()) return;
    const at = shipAt(f, c);
    switch (this.mode) {
      case 'shield':
        if (at && this.shipSelectable(at.ship.id)) this.selShip = at.ship.id;
        else return this.invalidTap();
        break;
      case 'repair':
        if (ctrl.canSelf({ t: 'repair', c })) this.target = c;
        else return this.invalidTap();
        break;
      case 'hologram':
        if (ctrl.canSelf({ t: 'hologram', c })) this.target = c;
        else return this.invalidTap();
        break;
      case 'jump':
        if (at && this.shipSelectable(at.ship.id) && (this.selShip === null || at.ship.id !== this.selShip)) {
          this.selShip = at.ship.id;
          this.jumpDir = at.ship.dir;
          this.target = null;
        } else if (this.selShip !== null) {
          this.target = c;
        } else return this.invalidTap();
        break;
    }
    this.own.focus = c;
    audio.play('select');
    vibrate(6);
    this.update();
  }

  private invalidTap() {
    audio.play('error');
    toast(t('battle.invalid'), 'warn', 900);
  }

  private rotate() {
    if (this.mode === 'salvo') this.salvoDir = this.salvoDir === 'h' ? 'v' : 'h';
    else if (this.mode === 'jump') this.jumpDir = this.jumpDir === 'h' ? 'v' : 'h';
    audio.play('select');
    this.update();
  }

  private execute() {
    const ctrl = this.s.ctrl;
    if (!this.isValid()) {
      audio.play('error');
      return;
    }
    let err: string | null;
    if (this.isOwnMode()) {
      err = ctrl.selfAction(this.selfRequest()!);
    } else {
      const a = this.attackAction()!;
      err = ctrl.attack(a);
      if (!err) {
        this.playLaunch(a, true);
        this.target = null;
        this.enemy.focus = null;
      }
    }
    if (err) {
      audio.play('error');
      toast(t('battle.invalid'), 'warn', 1000);
      return;
    }
    vibrate(25);
    if (this.mode !== 'shot') this.setMode('shot');
    else this.update();
  }

  // ---------- Effekte ----------

  /** Startanimation (Laser/Raketen) sofort beim Abfeuern. */
  private playLaunch(a: AttackAction, mine: boolean) {
    const bv = mine ? this.enemy : this.own;
    const fromY = mine ? 16.5 : -1.5;
    const cells = a.t === 'salvo' ? salvoCells(a.c, a.dir) : [a.c];
    if (a.t === 'shot') {
      bv.fx.laser(a.c, mine ? C.pink : C.orange, LAND_MS, 0, 7.5, fromY);
      audio.play('fire');
    } else if (a.t === 'salvo') {
      cells.forEach((c, i) => bv.fx.laser(c, C.yellow, LAND_MS, i * 90, 7.5 + (i - 1) * 3, fromY));
      audio.play('salvo');
    } else if (a.t === 'radar') {
      bv.fx.radarSweep(areaCells(a.c, BALANCE.radarSize));
      audio.play('radar');
    } else if (a.t === 'drone') {
      bv.fx.drone(a.c);
      audio.play('drone');
    } else if (a.t === 'emp') {
      bv.fx.emp(areaCells(a.c, BALANCE.empSize));
      audio.play('emp');
    }
  }

  private onFx(f: Fx) {
    const ctrl = this.s.ctrl;
    switch (f.kind) {
      case 'attack': {
        const mine = f.by === ctrl.me;
        if (!mine) this.playLaunch(f.action, false);
        if (f.result.t === 'shots') this.playOutcomes(f.result.outcomes, mine, f.action.t === 'salvo');
        else if (f.result.t === 'radar') {
          const bv = mine ? this.enemy : this.own;
          bv.fx.text(f.action.c, `${f.result.count}`, C.green, 900);
        } else if (f.result.t === 'drone') {
          const bv = mine ? this.enemy : this.own;
          bv.fx.text(f.action.c, f.result.r === 'ship' ? '◆' : '∅', C.yellow, 700);
        } else if (f.result.t === 'emp' && !mine) {
          flash('emp');
          vibrate([40, 30, 40]);
        }
        break;
      }
      case 'self': {
        const mine = f.by === ctrl.me;
        const sound: Partial<Record<string, Sfx>> = { shield: 'shield', repair: 'repair', hologram: 'hologram', jump: 'jump' };
        audio.play(sound[f.action.t] ?? 'select');
        if (mine && f.detail) this.playSelf(f.detail);
        else if (!mine) {
          if (f.action.t === 'repair') this.enemy.fx.pulseArea([f.action.c], C.green);
          if (f.action.t === 'jump') for (const c of f.action.cleared) this.enemy.fx.pulseArea([c], C.violet);
        }
        break;
      }
      case 'turn': {
        const mineTurn = f.active === ctrl.me;
        if (this.lastTurnActive !== f.active) {
          this.showBanner(mineTurn ? t('battle.yourTurn') : t('battle.oppTurn'), mineTurn ? 'good' : 'opp');
          if (mineTurn) {
            audio.play('turn');
            vibrate([20, 40, 20]);
          }
        }
        this.lastTurnActive = f.active;
        if (mineTurn) this.setMode('shot');
        break;
      }
      case 'event': {
        const e = f.event;
        audio.play('event');
        glitchScreen();
        vibrate([60, 40, 60]);
        this.showBanner(t(`event.${e}` as I18nKey), 'event', t(`event.${e}Desc` as I18nKey), 3200);
        break;
      }
      case 'combo':
        audio.play('combo');
        toast(t('battle.combo'), 'good', 1600);
        break;
      case 'over':
        break;
      default:
        break;
    }
    this.update();
  }

  private playOutcomes(outs: ShotOutcome[], mine: boolean, salvo: boolean) {
    const bv = mine ? this.enemy : this.own;
    const hold = mine ? this.holdEnemy : this.holdOwn;
    const now = performance.now();
    outs.forEach((o, i) => {
      const delay = LAND_MS + (salvo ? i * 90 : 0);
      hold.set(idx(o.c.x, o.c.y), now + delay);
      if (o.r === 'sunk' && o.ship) for (const c of shipCells(o.ship)) hold.set(idx(c.x, c.y), now + delay);
      setTimeout(() => this.landOutcome(o, mine, bv), delay);
    });
  }

  private landOutcome(o: ShotOutcome, mine: boolean, bv: BoardView) {
    switch (o.r) {
      case 'miss':
        bv.fx.ripple(o.c);
        bv.fx.text(o.c, t('fx.miss'), C.cyan);
        audio.play('miss');
        break;
      case 'hit':
        bv.fx.explosion(o.c);
        bv.fx.text(o.c, t('fx.hit'), C.orange);
        audio.play('hit');
        vibrate(mine ? 30 : [50, 30, 50]);
        if (!mine) flash('hit');
        break;
      case 'sunk': {
        const cells = o.ship ? shipCells(o.ship) : [o.c];
        cells.forEach((c, i) => setTimeout(() => bv.fx.explosion(c, i === 0 || i === cells.length - 1), i * 70));
        bv.fx.text(o.c, t('fx.sunk'), C.red);
        if (o.ship) {
          if (mine) this.sunkEnemy.mark(o.ship);
          else {
            const own = this.s.ctrl.core.fleet?.ships.find((sh) => sh.sunk && shipCells(sh).some((c) => sameCell(c, o.c)));
            if (own) this.sunkOwn.mark(own);
          }
        } else if (!mine) {
          const own = this.s.ctrl.core.fleet?.ships.find((sh) => sh.sunk && shipCells(sh).some((c) => sameCell(c, o.c)));
          if (own) this.sunkOwn.mark(own);
        }
        audio.play('sunk');
        vibrate(mine ? [40, 30, 80] : [100, 50, 150]);
        if (mine) glitchScreen();
        else flash('hit');
        bv.fx.addShake(0.45, 700);
        break;
      }
      case 'mine':
        bv.fx.explosion(o.c, true);
        bv.fx.shockwave(o.c, C.yellow, 2.6, 800);
        bv.fx.text(o.c, t('fx.mine'), C.yellow);
        audio.play('mine');
        vibrate(mine ? [80, 40, 120] : 30);
        if (mine) flash('hit');
        break;
      case 'shield':
        bv.fx.shockwave(o.c, C.green, 1.6, 600);
        bv.fx.burst(o.c.x + 0.5, o.c.y + 0.5, 30, [C.green, '#ffffff'], 3);
        bv.fx.text(o.c, t('fx.shield'), C.green);
        audio.play('shield');
        break;
    }
  }

  private playSelf(req: SelfRequest) {
    const f = this.s.ctrl.core.fleet;
    if (!f) return;
    switch (req.t) {
      case 'shield': {
        const sh = f.ships.find((x) => x.id === req.shipId);
        if (sh) this.own.fx.pulseArea(shipCells(sh), C.green);
        break;
      }
      case 'repair':
        this.own.fx.pulseArea([req.c], C.green);
        this.own.fx.beamColumn([req.c], C.green);
        break;
      case 'hologram':
        this.own.fx.pulseArea([req.c], C.violet);
        break;
      case 'jump': {
        const sh = f.ships.find((x) => x.id === req.shipId);
        if (sh) {
          this.own.fx.beamColumn(shipCells(sh), C.violet);
          this.own.fx.pulseArea(shipCells(sh), C.cyan, 1100);
        }
        break;
      }
    }
  }

  private bannerTimer: ReturnType<typeof setTimeout> | null = null;
  private showBanner(title: string, kind: string, sub = '', ms = 1300) {
    this.banner.className = `banner show ${kind}`;
    this.banner.replaceChildren(h('div', { class: 'banner-title glitch', 'data-text': title }, title), sub ? h('div', { class: 'banner-sub' }, sub) : '');
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => (this.banner.className = 'banner'), ms);
  }

  private paintOwnOverlay(ctx: CanvasRenderingContext2D, now: number) {
    if (this.mainIsEnemy || !this.isOwnMode()) return;
    const f = this.s.ctrl.core.fleet;
    if (!f) return;
    if (this.mode === 'jump' && this.selShip !== null && this.target) {
      const sh = f.ships.find((x) => x.id === this.selShip)!;
      const req = this.jumpRequest()!;
      const ok = this.s.ctrl.canSelf(req);
      const ghost = { kind: sh.kind, x: req.t === 'jump' ? req.x : 0, y: req.t === 'jump' ? req.y : 0, dir: this.jumpDir };
      for (const c of shipCells(ghost)) {
        ctx.fillStyle = rgba(ok ? C.violet : C.red, 0.18);
        ctx.fillRect(c.x, c.y, 1, 1);
      }
      drawShip(ctx, sh.kind, ghost.x, ghost.y, ghost.dir, now, { ghost: true, invalid: !ok, color: C.violet });
    } else if ((this.mode === 'repair' || this.mode === 'hologram') && this.target) {
      paintCrosshair(ctx, now, [this.target], this.mode === 'repair' ? C.green : C.violet, this.isValid());
    }
  }

  // ---------- Anzeige ----------

  tick() {
    const ctrl = this.s.ctrl;
    if (!ctrl.turnDeadline || ctrl.phase !== 'battle') {
      this.timerBar.classList.add('off');
      return;
    }
    this.timerBar.classList.remove('off');
    const left = Math.max(0, ctrl.turnDeadline - Date.now());
    const frac = left / (ctrl.turnSeconds * 1000);
    this.timerFill.style.transform = `scaleX(${frac})`;
    this.timerBar.classList.toggle('urgent', left < 10000);
  }

  update() {
    const ctrl = this.s.ctrl;
    const c = ctrl.core;
    const m = c.match;
    if (!m) return;
    const cyber = m.mode === 'cyber';
    this.oppName.textContent = c.oppName || t('common.opponent');
    this.roundChip.textContent = t('battle.round', { n: m.round });
    this.eventChip.classList.toggle('hidden', !m.event);
    if (m.event) this.eventChip.textContent = t(`event.${m.event}` as I18nKey);

    const myTurn = ctrl.myTurn;
    this.turnLabel.textContent = myTurn ? t('battle.yourTurn') : t('battle.oppTurn');
    this.turnLabel.className = `turn-label ${myTurn ? 'mine' : 'theirs'}`;
    this.el.classList.toggle('my-turn', myTurn);
    this.tick();

    // Energie
    if (cyber) {
      const e = m.energy[ctrl.me];
      this.renderEnergy(this.energyMe, e, myTurn && this.mode !== 'shot' ? specialCost(m, this.mode as SpecialId) : 0);
      this.energyMeNum.textContent = `${e}`;
      this.renderEnergy(this.energyOpp, m.energy[ctrl.opp], 0);
      this.energyOppNum.textContent = `${m.energy[ctrl.opp]}`;
      if (e > this.lastEnergy && this.lastEnergy >= 0) {
        this.energyMe.classList.remove('gain');
        void this.energyMe.offsetWidth;
        this.energyMe.classList.add('gain');
      }
      this.lastEnergy = e;
    }

    // Flotten-Übersicht
    const sunkKinds = [...c.view.sunk.map((s) => s.kind)];
    this.fleetEnemy.replaceChildren(
      ...FLEET.map((kind) => {
        const i = sunkKinds.indexOf(kind);
        const sunk = i >= 0;
        if (sunk) sunkKinds.splice(i, 1);
        return h('i', { class: `pip ${sunk ? 'dead' : ''}`, style: `--l:${SHIP_LENGTH[kind]}` });
      }),
    );
    this.fleetMine.replaceChildren(...(c.fleet?.ships ?? []).map((sh) => h('i', { class: `pip ${sh.sunk ? 'dead' : sh.hits.some(Boolean) ? 'hurt' : ''} ${sh.shield ? 'shielded' : ''}`, style: `--l:${SHIP_LENGTH[sh.kind]}` })));

    // Spezialaktionen
    for (const [id, b] of this.specialBtns) {
      const blk = this.block(id);
      const cost = specialCost(m, id);
      b.querySelector('.sp-cost')!.textContent = `${cost}`;
      const lockTxt = blk && blk !== 'turn' && blk !== 'mode' && blk !== 'energy' ? t(`block.${blk}` as I18nKey) || '' : '';
      b.querySelector('.sp-lock')!.textContent = blk === 'blackout' ? t('battle.blackout') : lockTxt;
      b.classList.toggle('locked', blk !== null);
      b.classList.toggle('active', this.mode === id);
      b.classList.toggle('discount', cost < SPECIALS[id].cost);
    }

    // Feuer-Knopf
    const valid = this.isValid();
    this.fireBtn.disabled = !valid;
    this.fireBtn.querySelector('b')!.textContent = ctrl.busy ? t('battle.waiting') : this.mode === 'shot' ? t('battle.fire') : t('battle.confirm');
    this.fireBtn.classList.toggle('special-mode', this.mode !== 'shot');
    this.rotBtn.classList.toggle('hidden', this.mode !== 'salvo' && this.mode !== 'jump');
    this.cancelBtn.classList.toggle('hidden', this.mode === 'shot');

    // Hinweis
    let hint = '';
    if (!myTurn) hint = m.empBlocked[ctrl.me] ? t('battle.empBlocked') : '';
    else if (m.empBlocked[ctrl.me] && cyber) hint = t('battle.empBlocked');
    else if (this.mode === 'shield') hint = t('battle.tapShip');
    else if (this.mode === 'repair') hint = t('battle.tapHit');
    else if (this.mode === 'hologram') hint = t('battle.tapFree');
    else if (this.mode === 'jump') hint = this.selShip === null ? t('battle.tapShip') : t('battle.tapDest');
    else if (!this.target) hint = t('battle.selectTarget');
    else hint = `${t(this.mode === 'shot' ? 'battle.selectTarget' : (`special.${this.mode}` as I18nKey))}: ${cellName(this.target)}`;
    if (myTurn && m.shotsLeft > 1) hint = `${t('battle.extraShot')} ${hint}`;
    this.hint.textContent = hint;

    // Tags
    this.mainTag.textContent = this.mainIsEnemy ? `${t('battle.enemyGrid')} · ${c.oppName || t('common.opponent')}` : t('battle.ownGrid');
    this.mainTag.className = `board-tag ${this.mainIsEnemy ? 'enemy' : 'own'}`;
    this.miniTag.textContent = this.mainIsEnemy ? t('battle.ownGrid') : t('battle.enemyGrid');
    const blackout = m.event === 'blackout';
    this.blackout.classList.toggle('hidden', !(blackout && this.mainIsEnemy));
    this.mainSlot.classList.toggle('enemy', this.mainIsEnemy);
    if (!myTurn) {
      this.enemy.focus = null;
      if (!this.mainIsEnemy && this.isOwnMode()) this.setMode('shot');
    } else if (this.mainIsEnemy) this.enemy.focus = this.target;

    this.renderLog(false);
  }

  private renderEnergy(bar: HTMLElement, e: number, cost: number) {
    const max = BALANCE.energy.max;
    if (bar.childElementCount !== max) bar.replaceChildren(...Array.from({ length: max }, () => h('i')));
    [...bar.children].forEach((el, i) => {
      el.className = i < e ? (i >= e - cost ? 'on cost' : 'on') : '';
    });
  }

  private describe(e: LogEntry): string {
    const ctrl = this.s.ctrl;
    const who = e.actor === ctrl.me ? t('log.you') : t('log.opp');
    const a = e.action;
    const r = e.result;
    const shipName = (o: ShotOutcome) => (o.ship ? t(`ship.${o.ship.kind}` as I18nKey) : '');
    switch (a.t) {
      case 'shot': {
        const o = r.t === 'shots' ? r.outcomes[0] : null;
        const res = o ? (o.r === 'sunk' ? t('result.sunk', { ship: shipName(o) }) : t(`result.${o.r}` as I18nKey)) : '';
        return t('log.shot', { who, c: cellName(a.c), r: res });
      }
      case 'salvo': {
        const n = r.t === 'shots' ? r.outcomes.filter((o) => o.r === 'hit' || o.r === 'sunk').length : 0;
        const sunk = r.t === 'shots' ? r.outcomes.filter((o) => o.r === 'sunk') : [];
        return t('log.salvo', { who, c: cellName(a.c), n }) + sunk.map((o) => ` · ${t('result.sunk', { ship: shipName(o) })}`).join('');
      }
      case 'radar':
        return t('log.radar', { who, c: cellName(a.c), n: r.t === 'radar' ? r.count : '?' });
      case 'drone':
        return t('log.drone', { who, c: cellName(a.c), r: r.t === 'drone' ? t(`result.${r.r === 'ship' ? 'ship' : 'empty'}`) : '' });
      case 'emp':
        return t('log.emp', { who, c: cellName(a.c) });
      case 'repair':
        return t('log.repair', { who, c: cellName(a.c) });
      default:
        return t(`log.${a.t}` as I18nKey, { who });
    }
  }

  private renderLog(full: boolean) {
    const log = this.s.ctrl.core.log;
    if (!full) {
      const last = log.slice(-2).reverse();
      this.ticker.replaceChildren(...last.map((e, i) => h('div', { class: `tick-line ${e.actor === this.s.ctrl.me ? 'me' : 'opp'} ${i ? 'old' : ''}` }, this.describe(e))));
      return;
    }
    this.logPanel.replaceChildren(
      h('div', { class: 'panel log-box' }, h('h3', null, t('battle.log')), h('ol', null, ...[...log].reverse().map((e) => h('li', { class: e.actor === this.s.ctrl.me ? 'me' : 'opp' }, h('small', null, `R${e.round}`), ' ', this.describe(e))))),
    );
  }
}
