import { isEnvelope, type Envelope, type GameMsg } from './protocol';
import type { Transport, TransportStatus } from './transport';

export interface SessionSnapshot {
  nextId: number;
  lastRecv: number;
  outbox: { id: number; m: GameMsg }[];
  peerClient: string | null;
}

export type LinkState = 'offline' | 'connecting' | 'waiting' | 'online' | 'reconnecting' | 'error';

const PING_MS = 2500;
const STALE_MS = 10000;

/**
 * Zuverlässige, geordnete Nachrichtenschicht über einem beliebigen Transport.
 * Jede Spielnachricht hat eine laufende ID, wird bestätigt und nach einem
 * Reconnect (oder Neuladen der Seite) ab der letzten bestätigten ID erneut gesendet.
 */
export class Session {
  private snap: SessionSnapshot;
  private synced = false;
  private lastSeen = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private transportStatus: TransportStatus = 'idle';
  state: LinkState = 'offline';
  rtt = 0;

  onMessage: (m: GameMsg) => void = () => {};
  onLink: (s: LinkState, detail?: string) => void = () => {};
  /** Ein anderer Client als der bekannte meldet sich. Rückgabe true = übernehmen. */
  onForeignPeer: (client: string) => boolean = () => true;
  /** Gegenseite kennt Nachrichten, die wir nicht mehr haben (Zustand verloren). */
  onDesync: () => void = () => {};
  onPersist: () => void = () => {};

  constructor(
    private transport: Transport,
    readonly clientId: string,
    snapshot?: SessionSnapshot,
  ) {
    this.snap = snapshot ? structuredClone(snapshot) : { nextId: 1, lastRecv: 0, outbox: [], peerClient: null };
    transport.onData = (d) => this.receive(d);
    transport.onStatus = (s, detail) => this.status(s, detail);
  }

  get snapshot(): SessionSnapshot {
    return this.snap;
  }

  get peerClient() {
    return this.snap.peerClient;
  }

  start() {
    this.transport.start();
    if (!this.pingTimer) this.pingTimer = setInterval(() => this.heartbeat(), PING_MS);
  }

  close() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.transport.close();
  }

  send(m: GameMsg) {
    const id = this.snap.nextId++;
    this.snap.outbox.push({ id, m });
    this.onPersist();
    if (this.synced) this.raw({ s: 'msg', id, m });
  }

  /** Unzuverlässig, ohne Warteschlange (z. B. Ablehnung, Emotes). */
  sendRaw(m: GameMsg) {
    this.raw({ s: 'raw', m });
  }

  /** Setzt die Nummerierung zurück (neuer Gegner). */
  resetPeer(client: string | null) {
    this.snap = { nextId: 1, lastRecv: 0, outbox: [], peerClient: client };
    this.onPersist();
  }

  private raw(e: Envelope) {
    return this.transport.send(e);
  }

  private setLink(s: LinkState, detail?: string) {
    if (this.state === s && !detail) return;
    this.state = s;
    this.onLink(s, detail);
  }

  private status(s: TransportStatus, detail?: string) {
    this.transportStatus = s;
    if (s === 'open') {
      this.synced = false;
      this.lastSeen = Date.now();
      this.raw({ s: 'resume', last: this.snap.lastRecv, client: this.clientId });
      this.setLink('connecting');
      return;
    }
    this.synced = false;
    const map: Record<TransportStatus, LinkState> = {
      idle: 'offline',
      waiting: 'waiting',
      connecting: 'connecting',
      open: 'online',
      reconnecting: 'reconnecting',
      closed: 'offline',
      error: 'error',
    };
    this.setLink(map[s], detail);
  }

  private heartbeat() {
    if (this.transportStatus !== 'open') return;
    this.raw({ s: 'ping', t: Date.now() });
    if (this.lastSeen && Date.now() - this.lastSeen > STALE_MS) {
      this.lastSeen = 0;
      this.synced = false;
      this.setLink('reconnecting', 'timeout');
      this.transport.restart();
    }
  }

  private receive(d: unknown) {
    if (!isEnvelope(d)) return;
    this.lastSeen = Date.now();
    switch (d.s) {
      case 'ping':
        this.raw({ s: 'pong', t: d.t });
        return;
      case 'pong':
        this.rtt = Date.now() - d.t;
        return;
      case 'raw':
        this.onMessage(d.m);
        return;
      case 'resume':
        this.handleResume(d.last, d.client);
        return;
      case 'ack':
        this.snap.outbox = this.snap.outbox.filter((o) => o.id > d.id);
        this.onPersist();
        return;
      case 'msg':
        if (!this.synced) return;
        if (d.id <= this.snap.lastRecv) {
          this.raw({ s: 'ack', id: this.snap.lastRecv });
          return;
        }
        if (d.id !== this.snap.lastRecv + 1) {
          // Lücke – neu synchronisieren.
          this.raw({ s: 'resume', last: this.snap.lastRecv, client: this.clientId });
          return;
        }
        this.snap.lastRecv = d.id;
        this.onPersist();
        this.raw({ s: 'ack', id: d.id });
        this.onMessage(d.m);
        return;
    }
  }

  private handleResume(last: number, client: string) {
    if (this.snap.peerClient === null) {
      // Erster Kontakt: bereits vorgemerkte Nachrichten (z. B. hello) bleiben erhalten.
      this.snap.peerClient = client;
    } else if (this.snap.peerClient !== client) {
      if (!this.onForeignPeer(client)) return;
      // Fremder Client startet bei 0 – unsere alten Nachrichten sind hinfällig.
      this.resetPeer(client);
      last = 0;
    }
    if (last >= this.snap.nextId) {
      this.onDesync();
      return;
    }
    const wasSynced = this.synced;
    this.snap.outbox = this.snap.outbox.filter((o) => o.id > last);
    this.synced = true;
    this.onPersist();
    if (!wasSynced) this.raw({ s: 'resume', last: this.snap.lastRecv, client: this.clientId });
    for (const o of this.snap.outbox) this.raw({ s: 'msg', id: o.id, m: o.m });
    this.setLink('online');
  }
}
