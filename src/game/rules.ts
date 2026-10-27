import { BALANCE, FLEET, SPECIALS, type GameMode, type SpecialId } from '../config/balance';
import { eventForRound } from './events';
import type { ActionResult, MatchState, PlayerId, PlayerStats, PublicAction } from './types';

/**
 * Öffentlicher, deterministischer Spielzustand. Beide Clients wenden dieselben
 * (Aktion, Ergebnis)-Paare in derselben Reihenfolge an und erhalten so denselben Zustand.
 */

const emptyStats = (): PlayerStats => ({ shots: 0, hits: 0, misses: 0, minesHit: 0, sunk: 0, specials: 0 });
export const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

export function createMatch(mode: GameMode, seed: number, starter: PlayerId): MatchState {
  const st: MatchState = {
    mode,
    seed,
    starter,
    active: starter,
    round: 1,
    turn: 0,
    energy: [BALANCE.energy.start, BALANCE.energy.start],
    combo: [0, 0],
    shotsLeft: 0,
    specialsLeft: 0,
    empBlocked: [false, false],
    event: null,
    used: [{}, {}],
    stats: [emptyStats(), emptyStats()],
    winner: null,
    lastComboTurn: -1,
  };
  beginRound(st);
  beginTurn(st);
  return st;
}

const clampEnergy = (n: number) => Math.max(0, Math.min(BALANCE.energy.max, n));

function addEnergy(st: MatchState, p: PlayerId, n: number) {
  if (st.mode !== 'cyber') return;
  st.energy[p] = clampEnergy(st.energy[p] + n);
}

function beginRound(st: MatchState) {
  st.event = eventForRound(st.seed, st.round, st.mode);
  if (st.event === 'boost') {
    addEnergy(st, 0, BALANCE.events.energyBoost);
    addEnergy(st, 1, BALANCE.events.energyBoost);
  }
}

function beginTurn(st: MatchState) {
  st.turn++;
  addEnergy(st, st.active, BALANCE.energy.perTurn);
  st.shotsLeft = 1;
  st.specialsLeft = st.mode === 'cyber' && !st.empBlocked[st.active] ? BALANCE.specialsPerTurn : 0;
}

function endTurn(st: MatchState) {
  st.empBlocked[st.active] = false;
  st.active = other(st.active);
  if (st.active === st.starter) {
    st.round++;
    beginRound(st);
  }
  beginTurn(st);
}

export function specialCost(st: MatchState, id: SpecialId): number {
  const discount = st.event === 'overcharge' ? BALANCE.events.overchargeDiscount : 0;
  return Math.max(0, SPECIALS[id].cost - discount);
}

export type SpecialBlock = 'mode' | 'turn' | 'emp' | 'energy' | 'limit' | 'slot' | null;

/** Warum ist eine Spezialaktion gerade nicht verfügbar? (null = verfügbar) */
export function specialBlock(st: MatchState, p: PlayerId, id: SpecialId): SpecialBlock {
  if (st.mode !== 'cyber') return 'mode';
  if (st.winner !== null || st.active !== p || st.shotsLeft <= 0) return 'turn';
  if (st.empBlocked[p]) return 'emp';
  const def = SPECIALS[id];
  if (def.perGame > 0 && (st.used[p][id] ?? 0) >= def.perGame) return 'limit';
  // Die Salve ersetzt den Schuss und belegt keinen Spezial-Slot.
  if (id !== 'salvo' && st.specialsLeft <= 0) return 'slot';
  if (st.energy[p] < specialCost(st, id)) return 'energy';
  return null;
}

const SPECIAL_OF: Partial<Record<PublicAction['t'], SpecialId>> = {
  salvo: 'salvo',
  radar: 'radar',
  drone: 'drone',
  emp: 'emp',
  shield: 'shield',
  repair: 'repair',
  hologram: 'hologram',
  jump: 'jump',
};

export const specialOf = (a: PublicAction): SpecialId | null => SPECIAL_OF[a.t] ?? null;

/** Prüft, ob der Akteur die Aktion jetzt ausführen darf. Liefert Fehlertext oder null. */
export function checkAction(st: MatchState, actor: PlayerId, action: PublicAction): string | null {
  if (st.winner !== null) return 'Spiel ist vorbei';
  if (st.active !== actor) return 'Nicht am Zug';
  if (st.shotsLeft <= 0) return 'Keine Schüsse übrig';
  const sp = specialOf(action);
  if (sp) {
    const b = specialBlock(st, actor, sp);
    if (b) return `Spezialaktion gesperrt (${b})`;
  }
  return null;
}

/** Wendet ein (Aktion, Ergebnis)-Paar auf den öffentlichen Zustand an. */
export function applyAction(st: MatchState, actor: PlayerId, action: PublicAction, result: ActionResult): void {
  const err = checkAction(st, actor, action);
  if (err) throw new Error(err);
  const sp = specialOf(action);
  const stats = st.stats[actor];
  if (sp) {
    st.energy[actor] = clampEnergy(st.energy[actor] - specialCost(st, sp));
    st.used[actor][sp] = (st.used[actor][sp] ?? 0) + 1;
    stats.specials++;
    if (sp !== 'salvo') st.specialsLeft--;
  }
  if (action.t === 'emp') st.empBlocked[other(actor)] = true;

  if (result.t !== 'shots') return; // Nicht-Angriffs-Aktionen beenden den Zug nicht.

  const cyber = st.mode === 'cyber';
  let endNow = false;
  let bonus = 0;
  for (const o of result.outcomes) {
    switch (o.r) {
      case 'hit':
      case 'sunk':
        stats.shots++;
        stats.hits++;
        addEnergy(st, actor, BALANCE.energy.perHit);
        if (o.r === 'sunk') {
          stats.sunk++;
          addEnergy(st, actor, BALANCE.energy.perSunk);
        }
        if (cyber) {
          st.combo[actor]++;
          if (st.combo[actor] >= BALANCE.combo.hitsForBonus) {
            st.combo[actor] = 0;
            bonus += BALANCE.combo.bonusShots;
            st.lastComboTurn = st.turn;
          }
        } else if (BALANCE.classic.extraShotOnHit) {
          bonus = 1;
        }
        break;
      case 'miss':
        stats.shots++;
        stats.misses++;
        st.combo[actor] = 0;
        break;
      case 'mine':
        stats.shots++;
        stats.minesHit++;
        st.combo[actor] = 0;
        if (cyber) st.energy[actor] = clampEnergy(st.energy[actor] - BALANCE.mines.energyPenalty);
        endNow = true;
        break;
      case 'shield':
        stats.shots++;
        break;
      case 'void':
        break;
    }
  }
  if (stats.sunk >= FLEET.length) {
    st.winner = actor;
    st.shotsLeft = 0;
    return;
  }
  st.shotsLeft = endNow ? 0 : st.shotsLeft - 1 + bonus;
  if (st.shotsLeft <= 0) endTurn(st);
}

/** Aufgeben: Gegner gewinnt sofort. */
export function forfeit(st: MatchState, loser: PlayerId): void {
  st.winner = other(loser);
}

export const isAttack = (a: PublicAction) => a.t === 'shot' || a.t === 'salvo' || a.t === 'radar' || a.t === 'drone' || a.t === 'emp';
