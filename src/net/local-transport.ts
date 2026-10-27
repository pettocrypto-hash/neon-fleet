import type { Transport, TransportStatus } from './transport';

/** In-Memory-Transport (KI-Gegner und Tests). Nachrichten werden asynchron zugestellt. */
export class LocalTransport implements Transport {
  peer: LocalTransport | null = null;
  private open = false;
  onData: (data: unknown) => void = () => {};
  onStatus: (status: TransportStatus, detail?: string) => void = () => {};

  constructor(public readonly role: 'host' | 'guest') {}

  static pair(): [LocalTransport, LocalTransport] {
    const a = new LocalTransport('host');
    const b = new LocalTransport('guest');
    a.peer = b;
    b.peer = a;
    return [a, b];
  }

  start(): void {
    this.open = true;
    queueMicrotask(() => this.onStatus('open'));
  }

  restart(): void {
    this.start();
  }

  send(data: unknown): boolean {
    const p = this.peer;
    if (!this.open || !p || !p.open) return false;
    const copy = JSON.parse(JSON.stringify(data));
    setTimeout(() => p.onData(copy), 0);
    return true;
  }

  close(): void {
    this.open = false;
    this.onStatus('closed');
  }
}
