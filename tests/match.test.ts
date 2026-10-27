import { describe, expect, it } from 'vitest';
import { AiPlayer, type Difficulty } from '../src/ai/ai';
import { MatchController } from '../src/app/controller';
import type { GameMode } from '../src/config/balance';
import { LocalTransport } from '../src/net/local-transport';
import { Session } from '../src/net/session';
import type { Transport, TransportStatus } from '../src/net/transport';

function waitFor(cond: () => boolean, ms = 20000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (cond()) {
        clearInterval(iv);
        resolve();
      } else if (Date.now() - t0 > ms) {
        clearInterval(iv);
        reject(new Error('timeout'));
      }
    }, 5);
  });
}

function setup(mode: GameMode, a: Difficulty, b: Difficulty) {
  const [ta, tb] = LocalTransport.pair();
  const sa = new Session(ta, 'host-client');
  const sb = new Session(tb, 'guest-client');
  const host = new MatchController(sa, { role: 'host', me: 0, name: 'Host', mode, turnSeconds: 0 });
  const guest = new MatchController(sb, { role: 'guest', me: 1, name: 'Gast' });
  const aiA = new AiPlayer(host, a, [0, 0], 11);
  const aiB = new AiPlayer(guest, b, [0, 0], 22);
  aiA.start();
  aiB.start();
  sa.start();
  sb.start();
  const stop = () => {
    aiA.stop();
    aiB.stop();
    host.dispose();
    guest.dispose();
  };
  return { host, guest, stop };
}

describe('Komplette Partie über das Protokoll (KI gegen KI)', () => {
  for (const [mode, a, b] of [
    ['cyber', 'hard', 'medium'],
    ['cyber', 'easy', 'hard'],
    ['classic', 'medium', 'medium'],
  ] as [GameMode, Difficulty, Difficulty][]) {
    it(`${mode}: ${a} vs ${b} endet mit Sieger und bestandener Fairness-Prüfung`, async () => {
      const { host, guest, stop } = setup(mode, a, b);
      try {
        await waitFor(() => host.phase === 'over' && guest.phase === 'over' && !!host.core.verify && !!guest.core.verify);
        expect(host.core.winner).not.toBeNull();
        expect(host.core.winner).toBe(guest.core.winner);
        expect(host.core.verify).toEqual({ ok: true });
        expect(guest.core.verify).toEqual({ ok: true });
        expect(host.core.match).toEqual(guest.core.match);
        expect(host.core.log.length).toBe(guest.core.log.length);
        expect(host.core.oppName).toBe('Gast');
        expect(host.core.oppShips).toHaveLength(10);
      } finally {
        stop();
      }
    }, 30000);
  }

  it('Revanche startet eine neue Partie', async () => {
    const { host, guest, stop } = setup('cyber', 'medium', 'medium');
    try {
      await waitFor(() => host.phase === 'over' && guest.phase === 'over');
      host.requestRematch();
      await waitFor(() => host.core.config?.game === 2 && guest.core.config?.game === 2 && host.phase === 'battle' && guest.phase === 'battle');
      expect(host.core.log.length).toBeLessThan(5);
    } finally {
      stop();
    }
  }, 30000);
});

/** Transport, dessen Verbindung im Test gezielt getrennt werden kann. */
class FlakyTransport implements Transport {
  peer: FlakyTransport | null = null;
  up = false;
  dropped = 0;
  onData: (d: unknown) => void = () => {};
  onStatus: (s: TransportStatus) => void = () => {};
  constructor(readonly role: 'host' | 'guest') {}
  start() {
    this.up = true;
    if (this.peer?.up) {
      queueMicrotask(() => {
        this.onStatus('open');
        this.peer!.onStatus('open');
      });
    }
  }
  restart() {}
  send(d: unknown) {
    if (!this.up || !this.peer?.up) {
      this.dropped++;
      return false;
    }
    const copy = JSON.parse(JSON.stringify(d));
    setTimeout(() => this.peer?.up && this.peer.onData(copy), 0);
    return true;
  }
  close() {
    this.up = false;
  }
  cut() {
    this.up = false;
    this.onStatus('reconnecting');
    this.peer!.onStatus('waiting');
  }
}

describe('Reconnect', () => {
  it('stellt nach Verbindungsabbruch und Neuladen den Spielstand wieder her', async () => {
    const ta = new FlakyTransport('host');
    const tb = new FlakyTransport('guest');
    ta.peer = tb;
    tb.peer = ta;
    const sa = new Session(ta, 'H');
    const sb = new Session(tb, 'G');
    const host = new MatchController(sa, { role: 'host', me: 0, name: 'H', mode: 'cyber', turnSeconds: 0 });
    const guest = new MatchController(sb, { role: 'guest', me: 1, name: 'G' });
    const aiA = new AiPlayer(host, 'medium', [0, 0], 1);
    let aiB = new AiPlayer(guest, 'medium', [0, 0], 2);
    aiA.start();
    aiB.start();
    sa.start();
    sb.start();
    try {
      await waitFor(() => (host.core.log.length ?? 0) > 20);
      // Verbindung kappen, Gast "lädt neu": Zustand aus Snapshot wiederherstellen.
      tb.cut();
      aiB.stop();
      const snap = structuredClone(sb.snapshot);
      const core = structuredClone(guest.core);
      guest.dispose();
      await new Promise((r) => setTimeout(r, 30));
      const tb2 = new FlakyTransport('guest');
      tb2.peer = ta;
      ta.peer = tb2;
      const sb2 = new Session(tb2, 'G', snap);
      const guest2 = new MatchController(sb2, { role: 'guest', me: 1, name: 'G', restore: core });
      aiB = new AiPlayer(guest2, 'medium', [0, 0], 3);
      aiB.start();
      ta.up = true;
      sb2.start();
      await waitFor(() => host.phase === 'over' && guest2.phase === 'over' && !!host.core.verify && !!guest2.core.verify);
      expect(host.core.match).toEqual(guest2.core.match);
      expect(host.core.verify).toEqual({ ok: true });
      expect(guest2.core.verify).toEqual({ ok: true });
      guest2.dispose();
    } finally {
      aiA.stop();
      aiB.stop();
      host.dispose();
    }
  }, 30000);
});
