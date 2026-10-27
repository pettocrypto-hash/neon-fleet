import { BALANCE, type GameMode } from '../config/balance';
import { salvoCells, validateLayout } from './board';
import { commitLayout } from './commitment';
import {
  applyHologram,
  applyJump,
  applyRepair,
  applyShield,
  createFleet,
  radarCount,
  resolveDrone,
  resolveEmp,
  resolveShot,
} from './fleet';
import type { Layout, LogEntry, PlayerId, PrivateDetail } from './types';

export interface Reveal {
  layout: Layout;
  salt: string;
  details: PrivateDetail[];
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

/**
 * Prüft nach Spielende, ob der Gegner ehrlich gespielt hat: Commitment passt zum Layout,
 * und jedes gemeldete Ergebnis entspricht der Nachsimulation aller Aktionen.
 */
export function verifyOpponent(commit: string, reveal: Reveal, log: LogEntry[], me: PlayerId, mode: GameMode): VerifyResult {
  if (commitLayout(reveal.layout, reveal.salt) !== commit) return { ok: false, reason: 'commit' };
  const lerr = validateLayout(reveal.layout, mode);
  if (lerr) return { ok: false, reason: `layout: ${lerr}` };
  const f = createFleet(reveal.layout);
  const detail = new Map(reveal.details.map((d) => [d.seq, d]));

  for (const e of [...log].sort((a, b) => a.seq - b.seq)) {
    const a = e.action;
    if (e.actor !== me) {
      // Selbst-Aktionen des Gegners nachspielen.
      if (a.t === 'shield') {
        const d = detail.get(e.seq);
        if (!d || d.t !== 'shield' || !applyShield(f, d.shipId)) return { ok: false, reason: `shield #${e.seq}` };
      } else if (a.t === 'repair') {
        if (!applyRepair(f, a.c)) return { ok: false, reason: `repair #${e.seq}` };
      } else if (a.t === 'hologram') {
        const d = detail.get(e.seq);
        if (!d || d.t !== 'hologram' || !applyHologram(f, d.c)) return { ok: false, reason: `hologram #${e.seq}` };
      } else if (a.t === 'jump') {
        const d = detail.get(e.seq);
        const cleared = d && d.t === 'jump' ? applyJump(f, d.shipId, d.x, d.y, d.dir) : null;
        if (!cleared || cleared.length !== a.cleared.length) return { ok: false, reason: `jump #${e.seq}` };
      }
      continue;
    }
    // Meine Angriffe gegen die aufgedeckte Flotte nachrechnen.
    const r = e.result;
    if (a.t === 'shot' || a.t === 'salvo') {
      const cells = a.t === 'shot' ? [a.c] : salvoCells(a.c, a.dir);
      if (r.t !== 'shots' || r.outcomes.length !== cells.length) return { ok: false, reason: `shots #${e.seq}` };
      for (let i = 0; i < cells.length; i++) {
        const o = resolveShot(f, cells[i]);
        if (o.r !== r.outcomes[i].r) return { ok: false, reason: `shot #${e.seq} ${o.r}≠${r.outcomes[i].r}` };
      }
    } else if (a.t === 'radar') {
      const real = radarCount(f, a.c);
      const tol = e.storm ? BALANCE.events.stormNoise : 0;
      if (r.t !== 'radar' || Math.abs(r.count - real) > tol) return { ok: false, reason: `radar #${e.seq}` };
    } else if (a.t === 'drone') {
      if (r.t !== 'drone' || resolveDrone(f, a.c) !== r.r) return { ok: false, reason: `drone #${e.seq}` };
    } else if (a.t === 'emp') {
      if (r.t !== 'emp' || resolveEmp(f, a.c) !== r.shieldsDown) return { ok: false, reason: `emp #${e.seq}` };
    }
  }
  return { ok: true };
}
