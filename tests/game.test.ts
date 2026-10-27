import { describe, expect, it } from 'vitest';
import { BALANCE, FLEET, SPECIALS } from '../src/config/balance';
import {
  areaCells,
  canPlace,
  randomLayout,
  salvoCells,
  shipCells,
  validateLayout,
} from '../src/game/board';
import { commitLayout } from '../src/game/commitment';
import { eventForRound } from '../src/game/events';
import {
  applyHologram,
  applyJump,
  applyRepair,
  applyShield,
  allSunk,
  createFleet,
  radarCount,
  resolveAttack,
  resolveDrone,
  resolveEmp,
  resolveShot,
} from '../src/game/fleet';
import { mulberry32 } from '../src/game/rng';
import { applyAction, createMatch, specialBlock, specialCost } from '../src/game/rules';
import { sha256Hex } from '../src/game/sha256';
import type { Layout, LogEntry, PlayerId, PrivateDetail, PublicAction } from '../src/game/types';
import { verifyOpponent } from '../src/game/verify';
import { applyResultToView, createView, viewAt } from '../src/game/view';

/** Feste Testaufstellung: alle Schiffe horizontal in eigenen Zeilen. */
function fixedLayout(): Layout {
  return {
    ships: FLEET.map((kind, id) => ({ id, kind, x: 0, y: id, dir: 'h' as const })),
    mines: [{ x: 14, y: 14 }, { x: 13, y: 14 }, { x: 12, y: 14 }],
  };
}

describe('SHA-256', () => {
  it('liefert bekannte Testvektoren', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  });
});

describe('Platzieren', () => {
  it('validiert eine korrekte Aufstellung', () => {
    expect(validateLayout(fixedLayout(), 'cyber')).toBeNull();
  });
  it('erkennt Überlappung, Rand und falsche Minenzahl', () => {
    const l = fixedLayout();
    l.ships[1] = { ...l.ships[1], y: 0 };
    expect(validateLayout(l, 'cyber')).toMatch(/überlappen/);
    const l2 = fixedLayout();
    l2.ships[0] = { ...l2.ships[0], x: 12 };
    expect(validateLayout(l2, 'cyber')).toMatch(/außerhalb/);
    expect(validateLayout(fixedLayout(), 'classic')).toMatch(/Minen/);
  });
  it('erlaubt sich berührende Schiffe', () => {
    const l = fixedLayout();
    expect(canPlace(l.ships, [], { id: 9, kind: 'skiff', x: 5, y: 9, dir: 'h' })).toBe(true);
  });
  it('erzeugt gültige Zufallsaufstellungen', () => {
    for (let s = 1; s < 60; s++) {
      expect(validateLayout(randomLayout(mulberry32(s), 'cyber'), 'cyber')).toBeNull();
      expect(validateLayout(randomLayout(mulberry32(s), 'classic'), 'classic')).toBeNull();
    }
  });
  it('begrenzt Salve und Bereich auf das Feld', () => {
    expect(salvoCells({ x: 0, y: 3 }, 'h')).toEqual([{ x: 0, y: 3 }, { x: 1, y: 3 }, { x: 2, y: 3 }]);
    expect(salvoCells({ x: 7, y: 14 }, 'v').map((c) => c.y)).toEqual([12, 13, 14]);
    expect(areaCells({ x: 0, y: 0 }, 3)).toHaveLength(9);
    expect(areaCells({ x: 0, y: 0 }, 3)[0]).toEqual({ x: 0, y: 0 });
  });
});

describe('Treffer & Versenken', () => {
  it('meldet Fehlschuss, Treffer, Versenkt und Mine', () => {
    const f = createFleet(fixedLayout());
    expect(resolveShot(f, { x: 10, y: 0 }).r).toBe('miss');
    expect(resolveShot(f, { x: 0, y: 0 }).r).toBe('hit');
    expect(resolveShot(f, { x: 0, y: 0 }).r).toBe('void');
    const skiff = resolveShot(f, { x: 0, y: 8 });
    expect(skiff.r).toBe('sunk');
    expect(skiff.ship?.kind).toBe('skiff');
    expect(resolveShot(f, { x: 14, y: 14 }).r).toBe('mine');
  });
  it('erkennt, wenn alle Schiffe versenkt sind', () => {
    const l = fixedLayout();
    const f = createFleet(l);
    for (const s of l.ships) for (const c of shipCells(s)) resolveShot(f, c);
    expect(allSunk(f)).toBe(true);
  });
  it('überträgt Ergebnisse in die Gegnersicht', () => {
    const f = createFleet(fixedLayout());
    const v = createView();
    const a: PublicAction = { t: 'shot', c: { x: 0, y: 9 } };
    applyResultToView(v, a, resolveAttack(f, a, [a.c]), 1);
    expect(viewAt(v, { x: 0, y: 9 })).toBe('sunk');
    expect(v.sunk).toHaveLength(1);
  });
});

describe('Spezialaktionen (Flotte)', () => {
  it('Radar zählt intakte Segmente', () => {
    const f = createFleet(fixedLayout());
    expect(radarCount(f, { x: 1, y: 1 })).toBe(9);
    resolveShot(f, { x: 0, y: 0 });
    expect(radarCount(f, { x: 1, y: 1 })).toBe(8);
    expect(radarCount(f, { x: 13, y: 13 })).toBe(0);
  });
  it('Drohne deckt Schiff auf, Minen bleiben unsichtbar', () => {
    const f = createFleet(fixedLayout());
    expect(resolveDrone(f, { x: 0, y: 0 })).toBe('ship');
    expect(resolveDrone(f, { x: 14, y: 14 })).toBe('empty');
  });
  it('Schild absorbiert den nächsten Treffer', () => {
    const f = createFleet(fixedLayout());
    expect(applyShield(f, 0)).toBe(true);
    expect(applyShield(f, 0)).toBe(false);
    expect(resolveShot(f, { x: 2, y: 0 }).r).toBe('shield');
    expect(resolveShot(f, { x: 2, y: 0 }).r).toBe('hit');
  });
  it('EMP schaltet Schilde im Gebiet ab', () => {
    const f = createFleet(fixedLayout());
    applyShield(f, 1);
    expect(resolveEmp(f, { x: 1, y: 1 })).toBe(1);
    expect(resolveShot(f, { x: 0, y: 1 }).r).toBe('hit');
  });
  it('Reparatur stellt Feld wieder her', () => {
    const f = createFleet(fixedLayout());
    resolveShot(f, { x: 0, y: 0 });
    expect(applyRepair(f, { x: 1, y: 0 })).toBe(false);
    expect(applyRepair(f, { x: 0, y: 0 })).toBe(true);
    expect(resolveShot(f, { x: 0, y: 0 }).r).toBe('hit');
  });
  it('Reparatur ist bei versenkten Schiffen nicht möglich', () => {
    const f = createFleet(fixedLayout());
    resolveShot(f, { x: 0, y: 8 });
    expect(applyRepair(f, { x: 0, y: 8 })).toBe(false);
  });
  it('Hologramm meldet einen Schein-Treffer', () => {
    const f = createFleet(fixedLayout());
    expect(applyHologram(f, { x: 0, y: 0 })).toBe(false);
    expect(applyHologram(f, { x: 10, y: 12 })).toBe(true);
    expect(applyHologram(f, { x: 10, y: 13 })).toBe(false);
    expect(resolveShot(f, { x: 10, y: 12 }).r).toBe('hit');
  });
  it('Sprung-Antrieb nur für unbeschädigte Schiffe auf freie Felder', () => {
    const f = createFleet(fixedLayout());
    expect(applyJump(f, 0, 0, 1, 'h')).toBeNull(); // belegt
    resolveDrone(f, { x: 0, y: 2 });
    const cleared = applyJump(f, 2, 5, 11, 'h');
    expect(cleared).toEqual([{ x: 0, y: 2 }]);
    expect(resolveShot(f, { x: 0, y: 2 }).r).toBe('miss');
    expect(resolveShot(f, { x: 5, y: 11 }).r).toBe('hit');
    expect(applyJump(f, 2, 5, 12, 'h')).toBeNull(); // beschädigt
  });
});

describe('Energie, Züge, Combo, Gewinn', () => {
  const shots = (...r: ('hit' | 'miss' | 'sunk' | 'mine')[]) => ({
    t: 'shots' as const,
    outcomes: r.map((k) => ({ c: { x: 0, y: 0 }, r: k })),
  });
  const shot: PublicAction = { t: 'shot', c: { x: 0, y: 0 } };

  it('gibt +1 Energie pro Zug und wechselt nach Fehlschuss', () => {
    const st = createMatch('cyber', 1, 0);
    expect(st.energy).toEqual([1, 0]);
    applyAction(st, 0, shot, shots('miss'));
    expect(st.active).toBe(1);
    expect(st.energy).toEqual([1, 1]);
    applyAction(st, 1, shot, shots('miss'));
    expect(st.round).toBe(2);
  });
  it('Treffer +1, Versenkt +2 extra, Maximum 10', () => {
    const st = createMatch('cyber', 1, 0);
    applyAction(st, 0, shot, shots('sunk'));
    expect(st.energy[0]).toBe(1 + BALANCE.energy.perHit + BALANCE.energy.perSunk);
    st.energy[0] = 9;
    st.active = 0;
    st.shotsLeft = 1;
    applyAction(st, 0, shot, shots('sunk'));
    expect(st.energy[0]).toBeLessThanOrEqual(BALANCE.energy.max);
  });
  it('Mine kostet 2 Energie und beendet den Zug', () => {
    const st = createMatch('cyber', 1, 0);
    st.energy[0] = 5;
    applyAction(st, 0, shot, shots('mine'));
    expect(st.energy[0]).toBe(3);
    expect(st.active).toBe(1);
  });
  it('Cyber: Treffer = nochmal, Fehlschuss beendet den Zug', () => {
    const st = createMatch('cyber', 1, 0);
    applyAction(st, 0, shot, shots('hit'));
    expect(st.active).toBe(0);
    expect(st.shotsLeft).toBe(1);
    applyAction(st, 0, shot, shots('miss'));
    expect(st.active).toBe(1);
  });
  it('3 Treffer in Folge geben einen Reserve-Schuss', () => {
    const st = createMatch('cyber', 1, 0);
    applyAction(st, 0, shot, shots('hit'));
    applyAction(st, 0, shot, shots('hit'));
    applyAction(st, 0, shot, shots('hit'));
    expect(st.active).toBe(0);
    expect(st.shotsLeft).toBe(2);
    applyAction(st, 0, shot, shots('miss'));
    expect(st.active).toBe(0);
    applyAction(st, 0, shot, shots('miss'));
    expect(st.active).toBe(1);
  });
  it('Klassisch: kein Energie, Treffer = nochmal', () => {
    const st = createMatch('classic', 1, 0);
    applyAction(st, 0, shot, shots('hit'));
    expect(st.active).toBe(0);
    expect(st.energy).toEqual([0, 0]);
    expect(specialBlock(st, 0, 'radar')).toBe('mode');
  });
  it('Spezialaktionen kosten Energie und sind begrenzt', () => {
    const st = createMatch('cyber', 1, 0);
    expect(specialBlock(st, 0, 'radar')).toBe('energy');
    st.energy[0] = 10;
    applyAction(st, 0, { t: 'radar', c: { x: 5, y: 5 } }, { t: 'radar', count: 0 });
    expect(st.energy[0]).toBe(10 - SPECIALS.radar.cost);
    expect(specialBlock(st, 0, 'drone')).toBe('slot');
    expect(specialBlock(st, 0, 'salvo')).toBeNull();
    applyAction(st, 0, { t: 'salvo', c: { x: 5, y: 5 }, dir: 'h' }, shots('miss', 'miss', 'miss'));
    expect(st.active).toBe(1);
  });
  it('Hologramm nur einmal pro Spiel', () => {
    const st = createMatch('cyber', 1, 0);
    st.energy[0] = 10;
    applyAction(st, 0, { t: 'hologram' }, { t: 'ack' });
    applyAction(st, 0, shot, shots('miss'));
    applyAction(st, 1, shot, shots('miss'));
    expect(specialBlock(st, 0, 'hologram')).toBe('limit');
  });
  it('EMP sperrt die Spezialaktionen des Gegners im nächsten Zug', () => {
    const st = createMatch('cyber', 1, 0);
    st.energy = [10, 10];
    applyAction(st, 0, { t: 'emp', c: { x: 3, y: 3 } }, { t: 'emp', shieldsDown: 0 });
    applyAction(st, 0, shot, shots('miss'));
    expect(specialBlock(st, 1, 'radar')).toBe('emp');
    expect(() => applyAction(st, 1, { t: 'radar', c: { x: 1, y: 1 } }, { t: 'radar', count: 0 })).toThrow();
    applyAction(st, 1, shot, shots('miss'));
    applyAction(st, 0, shot, shots('miss'));
    expect(specialBlock(st, 1, 'radar')).toBeNull();
  });
  it('Gewinn nach 10 versenkten Schiffen', () => {
    const st = createMatch('classic', 1, 0);
    for (let i = 0; i < FLEET.length; i++) applyAction(st, 0, shot, shots('sunk'));
    expect(st.winner).toBe(0);
    expect(() => applyAction(st, 0, shot, shots('miss'))).toThrow();
  });
  it('Nicht am Zug → Fehler', () => {
    const st = createMatch('cyber', 1, 0);
    expect(() => applyAction(st, 1, shot, shots('miss'))).toThrow();
  });
});

describe('Events', () => {
  it('kommen alle 8 Runden, deterministisch, nur im Cyber-Modus', () => {
    expect(eventForRound(42, 7, 'cyber')).toBeNull();
    expect(eventForRound(42, 8, 'cyber')).not.toBeNull();
    expect(eventForRound(42, 8, 'cyber')).toBe(eventForRound(42, 8, 'cyber'));
    expect(eventForRound(42, 8, 'classic')).toBeNull();
  });
  it('Überladung senkt Kosten', () => {
    const st = createMatch('cyber', 1, 0);
    st.event = 'overcharge';
    expect(specialCost(st, 'jump')).toBe(SPECIALS.jump.cost - BALANCE.events.overchargeDiscount);
  });
});

describe('Fairness / Commitment', () => {
  function playLog(cheat: boolean) {
    const layout = fixedLayout();
    const salt = 'abc123';
    const commit = commitLayout(layout, salt);
    const f = createFleet(layout);
    const log: LogEntry[] = [];
    const details: PrivateDetail[] = [];
    let seq = 0;
    const me: PlayerId = 0;
    const attack = (a: PublicAction & { c: { x: number; y: number } }) => {
      const cells = a.t === 'salvo' ? salvoCells(a.c, a.dir) : [a.c];
      const result = resolveAttack(f, a as never, cells);
      if (cheat && result.t === 'shots') for (const o of result.outcomes) if (o.r === 'hit') o.r = 'miss';
      log.push({ seq: seq++, actor: me, round: 1, storm: false, action: a, result });
    };
    attack({ t: 'shot', c: { x: 3, y: 0 } });
    applyShield(f, 1);
    details.push({ seq, t: 'shield', shipId: 1 });
    log.push({ seq: seq++, actor: 1, round: 1, storm: false, action: { t: 'shield' }, result: { t: 'ack' } });
    attack({ t: 'salvo', c: { x: 1, y: 1 }, dir: 'h' });
    attack({ t: 'radar', c: { x: 5, y: 5 } });
    attack({ t: 'drone', c: { x: 0, y: 6 } });
    applyHologram(f, { x: 9, y: 12 });
    details.push({ seq, t: 'hologram', c: { x: 9, y: 12 } });
    log.push({ seq: seq++, actor: 1, round: 1, storm: false, action: { t: 'hologram' }, result: { t: 'ack' } });
    attack({ t: 'shot', c: { x: 9, y: 12 } });
    const cleared = applyJump(f, 6, 3, 12, 'v')!;
    details.push({ seq, t: 'jump', shipId: 6, x: 3, y: 12, dir: 'v' });
    log.push({ seq: seq++, actor: 1, round: 1, storm: false, action: { t: 'jump', cleared }, result: { t: 'ack' } });
    attack({ t: 'shot', c: { x: 3, y: 13 } });
    return { commit, reveal: { layout, salt, details }, log };
  }

  it('bestätigt ehrliches Spiel', () => {
    const { commit, reveal, log } = playLog(false);
    expect(verifyOpponent(commit, reveal, log, 0, 'cyber')).toEqual({ ok: true });
  });
  it('erkennt falsche Ergebnisse', () => {
    const { commit, reveal, log } = playLog(true);
    expect(verifyOpponent(commit, reveal, log, 0, 'cyber').ok).toBe(false);
  });
  it('erkennt nachträglich geänderte Aufstellung', () => {
    const { commit, reveal, log } = playLog(false);
    const moved = { ...reveal, layout: { ...reveal.layout, ships: reveal.layout.ships.map((s) => (s.id === 0 ? { ...s, y: 14 } : s)) } };
    expect(verifyOpponent(commit, moved, log, 0, 'cyber')).toEqual({ ok: false, reason: 'commit' });
  });
});
