import { randomLayout } from '../game/board';
import { mulberry32, randomSeed } from '../game/rng';
import { t, type I18nKey } from '../i18n';
import type { App, Screen } from './app';
import { BattleView } from './battle-view';
import { button, h, toast } from './dom';
import { linkLabel } from './lobby';
import { startScreen } from './menus';
import { OverView } from './over-view';
import { SetupView } from './setup-view';

export interface PhaseView {
  el: HTMLElement;
  update(): void;
  tick?(): void;
  destroy(): void;
}

/** Container für Aufbau → Kampf → Ende einer Sitzung. Wechselt die Ansicht je nach Phase. */
export function gameScreen(app: App): Screen {
  const s = app.session!;
  const ctrl = s.ctrl;
  const el = h('section', { class: 'game' });
  const linkBar = h('div', { class: 'link-overlay hidden' }, h('div', { class: 'link-box panel' }, h('h3', { class: 'glitch-sm' }, t('link.lostTitle')), h('p', { class: 'txt' }), h('div', { class: 'loader' }, h('i'), h('i'), h('i')), button(t('common.menu'), () => leave(false), 'ghost small')));
  let view: PhaseView | null = null;
  let viewPhase = '';
  let shownFatal = false;

  const leave = (clear = true) => {
    app.setSession(null, clear);
    app.go(startScreen);
  };

  const mount = () => {
    const phase = ctrl.phase === 'battle' ? 'battle' : ctrl.phase === 'over' ? 'over' : 'setup';
    if (phase === viewPhase && view) return;
    // Kampf → Ende: Kampfansicht noch kurz zeigen, damit die letzte Explosion sichtbar ist.
    const delay = viewPhase === 'battle' && phase === 'over' ? 1600 : 0;
    viewPhase = phase;
    const swap = () => {
      if (viewPhase !== phase) return;
      view?.destroy();
      view?.el.remove();
      view = phase === 'setup' ? new SetupView(s) : phase === 'battle' ? new BattleView(s) : new OverView(s, () => leave());
      el.insertBefore(view.el, linkBar);
      view.update();
    };
    if (delay) setTimeout(swap, delay);
    else swap();
  };

  const render = () => {
    if (ctrl.core.fatal && !shownFatal) {
      shownFatal = true;
      toast(t(`fatal.${ctrl.core.fatal}` as I18nKey), 'bad', 5000);
    }
    mount();
    view?.update();
    // Verbindungsanzeige (nur online und solange das Spiel läuft)
    const lost = s.kind === 'online' && ctrl.phase !== 'over' && ctrl.link !== 'online' && ctrl.phase !== 'lobby';
    linkBar.classList.toggle('hidden', !lost);
    if (lost) linkBar.querySelector('.txt')!.textContent = linkLabel(ctrl.link === 'waiting' && ctrl.role === 'host' ? 'reconnecting' : ctrl.link);
  };

  el.appendChild(linkBar);
  const off = ctrl.onChange(render);
  const rng = mulberry32(randomSeed());
  const tick = setInterval(() => {
    view?.tick?.();
    ctrl.tick(() => randomLayout(rng, ctrl.core.config?.mode ?? 'cyber'));
  }, 250);
  render();

  return {
    el,
    destroy() {
      off();
      clearInterval(tick);
      view?.destroy();
    },
  };
}
