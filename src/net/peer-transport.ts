import Peer, { type DataConnection } from 'peerjs';
import type { Transport, TransportStatus } from './transport';

const PREFIX = 'neonfleet-v1-';
export const peerIdForRoom = (room: string) => PREFIX + room;

/**
 * WebRTC-Transport über den kostenlosen öffentlichen PeerJS-Broker.
 * Host registriert die Peer-ID des Raumcodes, Gast verbindet sich dorthin.
 * Verbindungsabbrüche werden automatisch mit Backoff neu aufgebaut.
 */
export class PeerTransport implements Transport {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private closed = false;
  onData: (data: unknown) => void = () => {};
  onStatus: (status: TransportStatus, detail?: string) => void = () => {};

  constructor(
    public readonly role: 'host' | 'guest',
    public readonly room: string,
  ) {}

  start(): void {
    this.closed = false;
    this.ensurePeer();
  }

  restart(): void {
    if (this.closed) return;
    this.onStatus('reconnecting');
    this.dropConn();
    const peer = this.peer;
    if (!peer || peer.destroyed) {
      this.peer = null;
      this.ensurePeer();
    } else if (peer.disconnected) {
      try {
        peer.reconnect();
      } catch {
        this.destroyPeer();
        this.schedule(() => this.ensurePeer());
      }
    } else if (this.role === 'guest') {
      this.connectToHost();
    } else {
      this.onStatus('waiting');
    }
  }

  send(data: unknown): boolean {
    if (!this.conn || !this.conn.open) return false;
    try {
      this.conn.send(data);
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.dropConn();
    this.destroyPeer();
    this.onStatus('closed');
  }

  private schedule(fn: () => void) {
    if (this.closed) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const delay = Math.min(8000, 800 * 1.6 ** Math.min(this.attempts, 6));
    this.attempts++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.closed) fn();
    }, delay);
  }

  private destroyPeer() {
    const p = this.peer;
    this.peer = null;
    if (p) {
      try {
        p.destroy();
      } catch {
        /* ignorieren */
      }
    }
  }

  private dropConn() {
    const c = this.conn;
    this.conn = null;
    if (c) {
      try {
        c.close();
      } catch {
        /* ignorieren */
      }
    }
  }

  private ensurePeer() {
    if (this.closed || (this.peer && !this.peer.destroyed)) return;
    this.onStatus(this.attempts ? 'reconnecting' : 'connecting');
    const peer = this.role === 'host' ? new Peer(peerIdForRoom(this.room), { debug: 0 }) : new Peer({ debug: 0 });
    this.peer = peer;

    peer.on('open', () => {
      if (peer !== this.peer) return;
      if (this.role === 'host') {
        this.attempts = 0;
        if (!this.conn?.open) this.onStatus('waiting');
      } else {
        this.connectToHost();
      }
    });
    peer.on('connection', (c) => {
      if (this.role !== 'host' || peer !== this.peer) {
        c.close();
        return;
      }
      this.attachConn(c);
    });
    peer.on('disconnected', () => {
      // Verbindung zum Broker weg – eine bestehende WebRTC-Verbindung kann weiterlaufen.
      if (this.closed || peer !== this.peer) return;
      this.schedule(() => {
        if (peer !== this.peer || peer.destroyed || !peer.disconnected) return;
        try {
          peer.reconnect();
        } catch {
          this.destroyPeer();
          this.ensurePeer();
        }
      });
    });
    peer.on('error', (err: Error & { type?: string }) => {
      if (this.closed || peer !== this.peer) return;
      const type = err.type ?? 'unknown';
      if (type === 'peer-unavailable') {
        // Host (noch) nicht erreichbar – weiter versuchen.
        this.onStatus('waiting', type);
        this.schedule(() => this.connectToHost());
        return;
      }
      if (type === 'browser-incompatible') {
        this.onStatus('error', type);
        return;
      }
      // 'unavailable-id' (Raumcode nach Neuladen noch belegt), Netzwerk-/Serverfehler: später erneut.
      this.onStatus('reconnecting', type);
      this.destroyPeer();
      this.schedule(() => this.ensurePeer());
    });
  }

  private connectToHost() {
    const peer = this.peer;
    if (this.closed) return;
    if (!peer || peer.destroyed) {
      this.peer = null;
      this.ensurePeer();
      return;
    }
    if (peer.disconnected) {
      this.restart();
      return;
    }
    this.dropConn();
    this.onStatus(this.attempts ? 'reconnecting' : 'connecting');
    const c = peer.connect(peerIdForRoom(this.room), { reliable: true, serialization: 'json' });
    this.attachConn(c);
    // Falls kein 'open' kommt (Mobilfunk/NAT), erneut versuchen.
    const watchdog = setTimeout(() => {
      if (this.conn === c && !c.open) {
        this.dropConn();
        this.schedule(() => this.connectToHost());
      }
    }, 12000);
    c.on('open', () => clearTimeout(watchdog));
  }

  private attachConn(c: DataConnection) {
    if (this.role === 'host' && this.conn && this.conn !== c) this.dropConn();
    this.conn = c;
    c.on('open', () => {
      if (this.conn !== c) return;
      this.attempts = 0;
      this.onStatus('open');
    });
    c.on('data', (d) => {
      if (this.conn === c) this.onData(d);
    });
    const lost = () => {
      if (this.conn !== c) return;
      this.conn = null;
      if (this.closed) return;
      if (this.role === 'host') this.onStatus('waiting', 'lost');
      else {
        this.onStatus('reconnecting', 'lost');
        this.schedule(() => this.connectToHost());
      }
    };
    c.on('close', lost);
    c.on('error', lost);
  }
}
