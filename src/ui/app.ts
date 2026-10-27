import { audio } from '../audio/audio';
import type { GameSession } from '../app/game-session';
import { glitchScreen } from './dom';

export interface Screen {
  el: HTMLElement;
  destroy?(): void;
}

export type ScreenFactory = (app: App) => Screen;

/** Einfache Screen-Verwaltung mit Glitch-Übergang. */
export class App {
  current: Screen | null = null;
  session: GameSession | null = null;
  installPrompt: (Event & { prompt(): Promise<void> }) | null = null;

  constructor(readonly root: HTMLElement) {}

  go(factory: ScreenFactory) {
    this.current?.destroy?.();
    this.current?.el.remove();
    const s = factory(this);
    this.current = s;
    s.el.classList.add('screen');
    this.root.appendChild(s.el);
    glitchScreen();
    requestAnimationFrame(() => s.el.classList.add('in'));
  }

  setSession(s: GameSession | null, clearSave = true) {
    if (this.session && this.session !== s) this.session.dispose(clearSave);
    this.session = s;
    audio.setIntensity(s ? 1 : 0);
  }
}
