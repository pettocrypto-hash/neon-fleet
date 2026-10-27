import { BALANCE, type GameMode } from '../config/balance';
import { areaCells, salvoCells } from '../game/board';
import { commitLayout, newSalt } from '../game/commitment';
import {
  applyHologram,
  applyJump,
  applyRepair,
  applyShield,
  canHologram,
  canJump,
  canRepair,
  canShield,
  createFleet,
  resolveAttack,
  type FleetState,
} from '../game/fleet';
import { randomSeed } from '../game/rng';
import { applyAction, checkAction, createMatch, forfeit, isAttack, other } from '../game/rules';
import type {
  ActionResult,
  Cell,
  Dir,
  Layout,
  LogEntry,
  MatchState,
  PlayerId,
  PrivateDetail,
  PublicAction,
  ShipPlacement,
} from '../game/types';
import { verifyOpponent, type Reveal, type VerifyResult } from '../game/verify';
import { applyEnemySelfActionToView, applyResultToView, createView, isShootable, type EnemyView } from '../game/view';
import { PROTOCOL_VERSION, type GameMsg } from '../net/protocol';
import type { LinkState, Session, SessionSnapshot } from '../net/session';

export type Phase = 'lobby' | 'setup' | 'battle' | 'over';

export interface MatchConfig {
  game: number;
  mode: GameMode;
  turnSeconds: number;
  seed: number;
  starter: PlayerId;
}

export type AttackAction = Extract<PublicAction, { t: 'shot' | 'salvo' | 'radar' | 'drone' | 'emp' }>;
export type SelfRequest =
  | { t: 'shield'; shipId: number }
  | { t: 'repair'; c: Cell }
  | { t: 'hologram'; c: Cell }
  | { t: 'jump'; shipId: number; x: number; y: number; dir: Dir };

/** Kompletter, serialisierbarer Zustand einer Partie aus Sicht eines Spielers. */
export interface CoreState {
  phase: Phase;
  config: MatchConfig | null;
  oppName: string;
  layout: Layout | null;
  salt: string;
  myHash: string | null;
  oppHash: string | null;
  fleet: FleetState | null;
  view: EnemyView;
  match: MatchState | null;
  log: LogEntry[];
  details: PrivateDetail[];
  pending: { seq: number; action: AttackAction } | null;
  oppReveal: Reveal | null;
  verify: VerifyResult | null;
  oppShips: ShipPlacement[] | null;
  winner: PlayerId | null;
  forfeitBy: PlayerId | null;
  rematchMe: boolean;
  rematchOpp: boolean;
  /** Vom gegnerischen EMP markiertes Gebiet auf meinem Feld. */
  empOnMe: Cell[];
  setupDeadline: number;
  helloSent: boolean;
  fatal: string | null;
}

export type Fx =
  | { kind: 'attack'; by: PlayerId; action: AttackAction; result: ActionResult; cells: Cell[] }
  | { kind: 'self'; by: PlayerId; action: PublicAction; detail?: SelfRequest }
  | { kind: 'turn'; active: PlayerId; round: number }
  | { kind: 'event'; event: NonNullable<MatchState['event']> }
  | { kind: 'combo'; by: PlayerId }
  | { kind: 'over'; winner: PlayerId }
  | { kind: 'start' }
  | { kind: 'emote'; e: string };

export interface ControllerOptions {
  role: 'host' | 'guest';
  me: PlayerId;
  name: string;
  /** Für Online-Spiele: localStorage-Schlüssel zum Speichern. */
  persistKey?: string;
  room?: string;
  restore?: CoreState;
  /** Host: Einstellungen der nächsten Partie. */
  mode?: GameMode;
  turnSeconds?: number;
}

export interface SaveData {
  v: 1;
  savedAt: number;
  role: 'host' | 'guest';
  me: PlayerId;
  room: string;
  clientId: string;
  name: string;
  mode: GameMode;
  turnSeconds: number;
  session: SessionSnapshot;
  core: CoreState;
}

function freshCore(): CoreState {
  return {
    phase: 'lobby',
    config: null,
    oppName: '',
    layout: null,
    salt: '',
    myHash: null,
    oppHash: null,
    fleet: null,
    view: createView(),
    match: null,
    log: [],
    details: [],
    pending: null,
    oppReveal: null,
    verify: null,
    oppShips: null,
    winner: null,
    forfeitBy: null,
    rematchMe: false,
    rematchOpp: false,
    empOnMe: [],
    setupDeadline: 0,
    helloSent: false,
    fatal: null,
  };
}

export const attackCells = (a: AttackAction): Cell[] => (a.t === 'salvo' ? salvoCells(a.c, a.dir) : [a.c]);

/**
 * Steuert eine Partie: verbindet Spiellogik und Netzwerk. Völlig UI-unabhängig,
 * wird gleichermaßen für Online-Spiele und den KI-Gegner (über LocalTransport) genutzt.
 */
export class MatchController {
  core: CoreState;
  readonly me: PlayerId;
  readonly opp: PlayerId;
  readonly role: 'host' | 'guest';
  link: LinkState = 'offline';
  mode: GameMode;
  turnSeconds: number;
  turnDeadline = 0;
  private lastTurnKey = '';
  private changeListeners = new Set<() => void>();
  private fxListeners = new Set<(fx: Fx) => void>();
  private disposed = false;

  constructor(
    readonly session: Session,
    readonly opts: ControllerOptions,
  ) {
    this.me = opts.me;
    this.opp = other(opts.me);
    this.role = opts.role;
    this.mode = opts.mode ?? 'cyber';
    this.turnSeconds = opts.turnSeconds ?? BALANCE.timers.turnSeconds;
    this.core = opts.restore ? structuredClone(opts.restore) : freshCore();
    session.onMessage = (m) => this.receive(m);
    session.onLink = (s) => {
      this.link = s;
      if (s === 'online') this.onOnline();
      this.changed();
    };
    session.onForeignPeer = () => {
      // Während einer laufenden Partie keine fremden Spieler zulassen.
      if (this.core.phase === 'lobby') {
        // Neuer Gegner: Begrüßung erneut senden, sobald die Nummerierung zurückgesetzt ist.
        queueMicrotask(() => session.send({ k: 'hello', proto: PROTOCOL_VERSION, client: session.clientId, name: opts.name }));
        return true;
      }
      session.sendRaw({ k: 'reject', reason: 'full' });
      return false;
    };
    session.onDesync = () => {
      this.core.fatal = 'desync';
      this.changed();
    };
    session.onPersist = () => this.save();
    if (!this.core.helloSent) {
      this.core.helloSent = true;
      session.send({ k: 'hello', proto: PROTOCOL_VERSION, client: session.clientId, name: opts.name });
    }
    this.syncTurnTimer();
  }

  // ---------------- Abos ----------------

  onChange(fn: () => void) {
    this.changeListeners.add(fn);
    return () => this.changeListeners.delete(fn);
  }

  onFx(fn: (fx: Fx) => void) {
    this.fxListeners.add(fn);
    return () => this.fxListeners.delete(fn);
  }

  private changed() {
    if (this.disposed) return;
    this.syncTurnTimer();
    this.save();
    for (const fn of this.changeListeners) fn();
  }

  private fx(f: Fx) {
    for (const fn of this.fxListeners) fn(f);
  }

  dispose(clearSave = false) {
    this.disposed = true;
    this.changeListeners.clear();
    this.fxListeners.clear();
    this.session.close();
    if (clearSave && this.opts.persistKey) {
      try {
        localStorage.removeItem(this.opts.persistKey);
      } catch {
        /* ignorieren */
      }
    }
  }

  // ---------------- Getter ----------------

  get phase() {
    return this.core.phase;
  }
  get match() {
    return this.core.match;
  }
  get myTurn() {
    const m = this.core.match;
    return this.core.phase === 'battle' && !!m && m.active === this.me && m.winner === null;
  }
  get busy() {
    return this.core.pending !== null;
  }
  get online() {
    return this.link === 'online';
  }

  // ---------------- Persistenz ----------------

  save() {
    const key = this.opts.persistKey;
    if (!key || this.disposed) return;
    const data: SaveData = {
      v: 1,
      savedAt: Date.now(),
      role: this.role,
      me: this.me,
      room: this.opts.room ?? '',
      clientId: this.session.clientId,
      name: this.opts.name,
      mode: this.mode,
      turnSeconds: this.turnSeconds,
      session: this.session.snapshot,
      core: this.core,
    };
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch {
      /* Speicher voll/privat – Spiel läuft trotzdem */
    }
  }

  // ---------------- Netzwerk ----------------

  private send(m: GameMsg) {
    this.session.send(m);
  }

  private onOnline() {
    // Host startet die erste Partie, sobald ein Gegner da ist.
    if (this.role === 'host' && this.core.phase === 'lobby' && !this.core.config) this.newGame(1, randomSeed() % 2 === 0 ? 0 : 1);
  }

  private newGame(game: number, starter: PlayerId) {
    const cfg: MatchConfig = { game, mode: this.mode, turnSeconds: this.turnSeconds, seed: randomSeed(), starter };
    this.send({ k: 'config', ...cfg });
    this.applyConfig(cfg);
  }

  private applyConfig(cfg: MatchConfig) {
    const oppName = this.core.oppName;
    this.core = { ...freshCore(), helloSent: true, oppName };
    this.core.config = cfg;
    this.core.phase = 'setup';
    this.core.setupDeadline = Date.now() + BALANCE.timers.setupSeconds * 1000;
    this.mode = cfg.mode;
    this.turnSeconds = cfg.turnSeconds;
    this.changed();
  }

  private gameOf(m: GameMsg): number | null {
    return 'game' in m ? m.game : null;
  }

  private receive(m: GameMsg) {
    const g = this.gameOf(m);
    if (g !== null && m.k !== 'config' && this.core.config && g !== this.core.config.game) return;
    switch (m.k) {
      case 'hello':
        if (m.proto !== PROTOCOL_VERSION) this.core.fatal = 'version';
        this.core.oppName = m.name.slice(0, 20);
        break;
      case 'reject':
        this.core.fatal = m.reason;
        this.session.close();
        break;
      case 'config':
        if (this.role === 'guest' && (!this.core.config || m.game > this.core.config.game)) {
          this.applyConfig({ game: m.game, mode: m.mode, turnSeconds: m.turnSeconds, seed: m.seed, starter: m.starter });
          return;
        }
        break;
      case 'ready':
        this.core.oppHash = m.hash;
        this.tryStart();
        break;
      case 'action':
        this.onEnemyAction(m.seq, m.action);
        break;
      case 'result':
        this.onResult(m.seq, m.result);
        break;
      case 'reveal':
        this.onReveal(m.reveal);
        break;
      case 'forfeit':
        this.endByForfeit(this.opp);
        break;
      case 'rematch':
        this.core.rematchOpp = true;
        this.tryRematch();
        break;
      case 'emote':
        this.fx({ kind: 'emote', e: m.e });
        break;
    }
    this.changed();
  }

  // ---------------- Aufbau ----------------

  submitLayout(layout: Layout) {
    if (this.core.phase !== 'setup' || this.core.myHash || !this.core.config) return;
    this.core.layout = structuredClone(layout);
    this.core.salt = newSalt();
    this.core.myHash = commitLayout(layout, this.core.salt);
    this.send({ k: 'ready', game: this.core.config.game, hash: this.core.myHash });
    this.tryStart();
    this.changed();
  }

  private tryStart() {
    const c = this.core;
    if (c.phase !== 'setup' || !c.myHash || !c.oppHash || !c.layout || !c.config) return;
    c.fleet = createFleet(c.layout);
    c.match = createMatch(c.config.mode, c.config.seed, c.config.starter);
    c.phase = 'battle';
    this.fx({ kind: 'start' });
    this.afterMatchChange(c.match.lastComboTurn, 0, '');
  }

  // ---------------- Kampf ----------------

  /** Angriff auf das gegnerische Feld (Schuss, Salve, Radar, Drohne, EMP). */
  attack(action: AttackAction): string | null {
    const c = this.core;
    if (c.phase !== 'battle' || !c.match || !c.config) return 'phase';
    if (c.pending) return 'busy';
    const err = checkAction(c.match, this.me, action);
    if (err) return err;
    if (action.t === 'shot' && !isShootable(c.view, action.c)) return 'known';
    const seq = c.log.length;
    c.pending = { seq, action };
    this.send({ k: 'action', game: c.config.game, seq, action });
    this.changed();
    return null;
  }

  /** Spezialaktion auf das eigene Feld (Schild, Reparatur, Hologramm, Sprung). */
  selfAction(req: SelfRequest): string | null {
    const c = this.core;
    if (c.phase !== 'battle' || !c.match || !c.fleet || !c.config) return 'phase';
    if (c.pending) return 'busy';
    const probe: PublicAction = req.t === 'jump' ? { t: 'jump', cleared: [] } : req.t === 'repair' ? { t: 'repair', c: req.c } : { t: req.t };
    const err = checkAction(c.match, this.me, probe);
    if (err) return err;
    if (!this.canSelf(req)) return 'invalid';
    const seq = c.log.length;
    let action: PublicAction;
    let detail: PrivateDetail | null = null;
    switch (req.t) {
      case 'shield':
        applyShield(c.fleet, req.shipId);
        action = { t: 'shield' };
        detail = { seq, t: 'shield', shipId: req.shipId };
        break;
      case 'repair':
        applyRepair(c.fleet, req.c);
        action = { t: 'repair', c: req.c };
        break;
      case 'hologram':
        applyHologram(c.fleet, req.c);
        action = { t: 'hologram' };
        detail = { seq, t: 'hologram', c: req.c };
        break;
      case 'jump': {
        const cleared = applyJump(c.fleet, req.shipId, req.x, req.y, req.dir)!;
        action = { t: 'jump', cleared };
        detail = { seq, t: 'jump', shipId: req.shipId, x: req.x, y: req.y, dir: req.dir };
        break;
      }
    }
    if (detail) c.details.push(detail);
    const before = this.turnKey();
    this.pushLog(this.me, action, { t: 'ack' });
    this.send({ k: 'action', game: c.config.game, seq, action });
    this.fx({ kind: 'self', by: this.me, action, detail: req });
    this.afterMatchChange(c.match.lastComboTurn, 0, before);
    this.changed();
    return null;
  }

  canSelf(req: SelfRequest): boolean {
    const f = this.core.fleet;
    if (!f) return false;
    switch (req.t) {
      case 'shield':
        return canShield(f, req.shipId);
      case 'repair':
        return canRepair(f, req.c);
      case 'hologram':
        return canHologram(f, req.c);
      case 'jump':
        return canJump(f, req.shipId, req.x, req.y, req.dir);
    }
  }

  private pushLog(actor: PlayerId, action: PublicAction, result: ActionResult) {
    const m = this.core.match!;
    this.core.log.push({ seq: this.core.log.length, actor, round: m.round, storm: m.event === 'storm', action, result });
    applyAction(m, actor, action, result);
  }

  private onEnemyAction(seq: number, action: PublicAction) {
    const c = this.core;
    if (c.phase !== 'battle' || !c.match || !c.fleet || !c.config) return;
    if (seq !== c.log.length) return;
    const err = checkAction(c.match, this.opp, action);
    if (err) {
      console.warn('[NEON FLEET] Ungültige gegnerische Aktion', err, action);
      return;
    }
    const comboBefore = c.match.lastComboTurn;
    const before = this.turnKey();
    if (isAttack(action)) {
      const a = action as AttackAction;
      const cells = attackCells(a);
      const noise = a.t === 'radar' && c.match.event === 'storm' ? Math.round((Math.random() * 2 - 1) * BALANCE.events.stormNoise) : 0;
      const result = resolveAttack(c.fleet, a, cells, noise);
      if (a.t === 'emp') c.empOnMe = areaCells(a.c, BALANCE.empSize);
      this.pushLog(this.opp, action, result);
      this.send({ k: 'result', game: c.config.game, seq, result });
      this.fx({ kind: 'attack', by: this.opp, action: a, result, cells });
    } else {
      applyEnemySelfActionToView(c.view, action);
      this.pushLog(this.opp, action, { t: 'ack' });
      this.fx({ kind: 'self', by: this.opp, action });
    }
    this.afterMatchChange(comboBefore, this.opp, before);
  }

  private onResult(seq: number, result: ActionResult) {
    const c = this.core;
    if (!c.pending || c.pending.seq !== seq || !c.match) return;
    const action = c.pending.action;
    const comboBefore = c.match.lastComboTurn;
    const before = this.turnKey();
    const round = c.match.round;
    c.pending = null;
    this.pushLog(this.me, action, result);
    applyResultToView(c.view, action, result, round);
    this.fx({ kind: 'attack', by: this.me, action, result, cells: attackCells(action) });
    this.afterMatchChange(comboBefore, this.me, before);
  }

  private turnKey() {
    const m = this.core.match;
    return m ? `${m.turn}` : '';
  }

  private afterMatchChange(comboBefore: number, actor: PlayerId, turnBefore = '') {
    const c = this.core;
    const m = c.match;
    if (!m) return;
    if (m.lastComboTurn !== comboBefore) this.fx({ kind: 'combo', by: actor });
    if (m.winner !== null) {
      this.finish(m.winner);
      return;
    }
    if (this.turnKey() !== turnBefore) {
      // Nach Ende meines Zuges ist eine EMP-Markierung auf meinem Feld hinfällig.
      if (m.active === this.opp) c.empOnMe = [];
      this.fx({ kind: 'turn', active: m.active, round: m.round });
      // Neue Runde beginnt mit dem Startspieler – ggf. Event ankündigen.
      if (m.event && m.active === m.starter) this.fx({ kind: 'event', event: m.event });
    }
  }

  private finish(winner: PlayerId) {
    const c = this.core;
    if (c.phase === 'over') return;
    c.phase = 'over';
    c.winner = winner;
    c.pending = null;
    if (c.layout && c.config) this.send({ k: 'reveal', game: c.config.game, reveal: { layout: c.layout, salt: c.salt, details: c.details } });
    if (c.oppReveal) this.verifyReveal();
    this.fx({ kind: 'over', winner });
  }

  private endByForfeit(loser: PlayerId) {
    const c = this.core;
    if (c.phase === 'over' || c.phase === 'lobby') return;
    c.forfeitBy = loser;
    if (c.match) forfeit(c.match, loser);
    this.finish(other(loser));
  }

  forfeit() {
    if (!this.core.config || this.core.phase === 'over' || this.core.phase === 'lobby') return;
    this.send({ k: 'forfeit', game: this.core.config.game });
    this.endByForfeit(this.me);
    this.changed();
  }

  private onReveal(r: Reveal) {
    this.core.oppReveal = r;
    if (this.core.phase === 'over') this.verifyReveal();
  }

  private verifyReveal() {
    const c = this.core;
    const r = c.oppReveal;
    if (!r || !c.config) return;
    if (!c.oppHash) c.verify = { ok: false, reason: 'no-commit' };
    else c.verify = verifyOpponent(c.oppHash, r, c.log, this.me, c.config.mode);
    // Endpositionen der gegnerischen Schiffe (inkl. Sprüngen) zum Aufdecken.
    const ships = structuredClone(r.layout.ships);
    for (const d of [...r.details].sort((a, b) => a.seq - b.seq)) {
      if (d.t !== 'jump') continue;
      const s = ships.find((sh) => sh.id === d.shipId);
      if (s) Object.assign(s, { x: d.x, y: d.y, dir: d.dir });
    }
    c.oppShips = ships;
  }

  requestRematch() {
    const c = this.core;
    if (c.phase !== 'over' || c.rematchMe || !c.config) return;
    c.rematchMe = true;
    this.send({ k: 'rematch', game: c.config.game });
    this.tryRematch();
    this.changed();
  }

  private tryRematch() {
    const c = this.core;
    if (this.role !== 'host' || !c.rematchMe || !c.rematchOpp || !c.config) return;
    // Wer zuletzt angefangen hat, beginnt diesmal nicht.
    this.newGame(c.config.game + 1, other(c.config.starter));
  }

  sendEmote(e: string) {
    this.session.sendRaw({ k: 'emote', e });
  }

  setHostOptions(mode: GameMode, turnSeconds: number) {
    this.mode = mode;
    this.turnSeconds = turnSeconds;
  }

  // ---------------- Timer ----------------

  private syncTurnTimer() {
    const m = this.core.match;
    const key = m && this.core.phase === 'battle' ? `${this.core.config?.game}:${m.turn}` : '';
    if (key === this.lastTurnKey) return;
    this.lastTurnKey = key;
    this.turnDeadline = key && this.turnSeconds > 0 ? Date.now() + this.turnSeconds * 1000 : 0;
  }

  /** Regelmäßig aufrufen (z. B. jede Sekunde): erledigt Zeitüberschreitungen. */
  tick(randomLayout: () => Layout) {
    const c = this.core;
    const now = Date.now();
    if (c.phase === 'setup' && !c.myHash && c.setupDeadline && now > c.setupDeadline) {
      this.submitLayout(randomLayout());
    }
    if (this.myTurn && !c.pending && this.turnDeadline && now > this.turnDeadline && this.online) {
      const free: Cell[] = [];
      for (let y = 0; y < 15; y++) for (let x = 0; x < 15; x++) if (isShootable(c.view, { x, y })) free.push({ x, y });
      if (free.length) this.attack({ t: 'shot', c: free[Math.floor(Math.random() * free.length)] });
    }
  }
}
