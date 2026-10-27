import { AiPlayer, type Difficulty } from '../ai/ai';
import type { GameMode } from '../config/balance';
import { randomHex } from '../game/rng';
import { t } from '../i18n';
import { LocalTransport } from '../net/local-transport';
import { PeerTransport } from '../net/peer-transport';
import { Session } from '../net/session';
import { makeRoomCode } from '../net/transport';
import { MatchController, type SaveData } from './controller';
import { settings } from './settings';

const SAVE_PREFIX = 'neonfleet.save.';
const TAB_KEY = 'neonfleet.tabSave';
const SAVE_MAX_AGE = 6 * 3600 * 1000;

/** Eigener Speicherplatz je Raum und Rolle; der Tab merkt sich seinen (wichtig für Tests in zwei Tabs). */
function saveKey(room: string, role: 'host' | 'guest') {
  const key = `${SAVE_PREFIX}${room}.${role}`;
  try {
    sessionStorage.setItem(TAB_KEY, key);
  } catch {
    /* ignorieren */
  }
  return key;
}

/** Eine laufende Spielsitzung (online oder gegen KI). */
export class GameSession {
  constructor(
    readonly kind: 'online' | 'ai',
    readonly ctrl: MatchController,
    readonly room: string,
    readonly ai: AiPlayer | null = null,
    readonly aiCtrl: MatchController | null = null,
  ) {}

  get shareUrl() {
    const u = new URL(location.href);
    u.search = '';
    u.hash = '';
    u.searchParams.set('room', this.room);
    return u.toString();
  }

  dispose(clearSave = true) {
    this.ai?.stop();
    this.aiCtrl?.dispose();
    this.ctrl.dispose(clearSave && this.kind === 'online');
  }
}

export function createHost(mode: GameMode, turnSeconds: number): GameSession {
  const room = makeRoomCode();
  const transport = new PeerTransport('host', room);
  const session = new Session(transport, randomHex(8));
  const ctrl = new MatchController(session, { role: 'host', me: 0, name: settings.name, persistKey: saveKey(room, 'host'), room, mode, turnSeconds });
  session.start();
  return new GameSession('online', ctrl, room);
}

export function createGuest(room: string): GameSession {
  const transport = new PeerTransport('guest', room);
  const session = new Session(transport, randomHex(8));
  const ctrl = new MatchController(session, { role: 'guest', me: 1, name: settings.name, persistKey: saveKey(room, 'guest'), room });
  session.start();
  return new GameSession('online', ctrl, room);
}

export function createAiGame(difficulty: Difficulty, mode: GameMode, turnSeconds: number): GameSession {
  const [ta, tb] = LocalTransport.pair();
  const sHuman = new Session(ta, 'human');
  const sAi = new Session(tb, 'ai');
  const name = t('ai.name', { d: t(`ai.${difficulty}` as const) });
  const ctrl = new MatchController(sHuman, { role: 'host', me: 0, name: settings.name, mode, turnSeconds });
  const aiCtrl = new MatchController(sAi, { role: 'guest', me: 1, name, turnSeconds: 0 });
  const ai = new AiPlayer(aiCtrl, difficulty);
  ai.start();
  sHuman.start();
  sAi.start();
  return new GameSession('ai', ctrl, '', ai, aiCtrl);
}

function readSave(key: string): SaveData | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    if (d.v !== 1 || Date.now() - d.savedAt > SAVE_MAX_AGE || d.core.phase === 'over' || d.core.fatal) {
      localStorage.removeItem(key);
      return null;
    }
    return d;
  } catch {
    return null;
  }
}

/** Fortsetzbares Online-Spiel: bevorzugt das dieses Tabs, sonst das zuletzt gespeicherte. */
export function loadSave(): SaveData | null {
  try {
    const own = sessionStorage.getItem(TAB_KEY);
    const mine = own ? readSave(own) : null;
    if (mine) return mine;
    let best: SaveData | null = null;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(SAVE_PREFIX)) continue;
      const d = readSave(k);
      if (d && (!best || d.savedAt > best.savedAt)) best = d;
    }
    return best;
  } catch {
    return null;
  }
}

/** Entfernt den Spielstand dieses Tabs (neues Spiel gestartet). */
export function clearSave() {
  try {
    const own = sessionStorage.getItem(TAB_KEY);
    if (own) localStorage.removeItem(own);
    sessionStorage.removeItem(TAB_KEY);
  } catch {
    /* ignorieren */
  }
}

/** Setzt ein gespeichertes Online-Spiel mit demselben Raumcode fort. */
export function resumeSave(d: SaveData): GameSession {
  const transport = new PeerTransport(d.role, d.room);
  const session = new Session(transport, d.clientId, d.session);
  const ctrl = new MatchController(session, {
    role: d.role,
    me: d.me,
    name: d.name,
    persistKey: saveKey(d.room, d.role),
    room: d.room,
    restore: d.core,
    mode: d.mode,
    turnSeconds: d.turnSeconds,
  });
  session.start();
  return new GameSession('online', ctrl, d.room);
}
