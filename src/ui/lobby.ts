import QRCode from 'qrcode';
import { audio } from '../audio/audio';
import { vibrate } from '../app/settings';
import { t, type I18nKey } from '../i18n';
import type { App, Screen } from './app';
import { button, h, toast } from './dom';
import { gameScreen } from './game-screen';
import { startScreen } from './menus';

export function linkLabel(state: string, detail?: string): string {
  if (state === 'waiting' && detail === 'peer-unavailable') return t('lobby.notFound');
  return t(`link.${state}` as I18nKey);
}

export function lobbyScreen(app: App): Screen {
  const s = app.session!;
  const ctrl = s.ctrl;
  const isHost = ctrl.role === 'host';
  const status = h('div', { class: 'lobby-status' }, h('span', { class: 'dot' }), h('span', { class: 'txt' }, t('lobby.connecting')));
  const qr = h('canvas', { class: 'qr', width: 220, height: 220 });
  let detail = '';

  const leave = () => {
    app.setSession(null, true);
    app.go(startScreen);
  };

  const body: HTMLElement[] = [];
  if (isHost) {
    const url = s.shareUrl;
    QRCode.toCanvas(qr, url, { width: 220, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#12062aff', light: '#dffcffff' } }).catch(() => qr.remove());
    const share = async () => {
      const text = t('lobby.shareText', { room: s.room });
      if ('share' in navigator) {
        try {
          await navigator.share({ title: 'NEON FLEET', text, url });
          return;
        } catch {
          /* abgebrochen → kopieren */
        }
      }
      try {
        await navigator.clipboard.writeText(url);
        toast(t('lobby.copied'), 'good');
      } catch {
        toast(t('toast.copyFail'), 'bad');
      }
    };
    body.push(
      h('p', { class: 'lobby-label' }, t('lobby.code')),
      h('div', { class: 'room-code', 'aria-label': s.room }, ...[...s.room].map((ch, i) => h('span', { style: `--i:${i}` }, ch))),
      h('div', { class: 'qr-wrap' }, qr),
      h('p', { class: 'note' }, t('lobby.scan')),
      h('div', { class: 'row' }, button('share' in navigator ? t('lobby.share') : t('lobby.copy'), share, 'primary')),
    );
  } else {
    body.push(h('p', { class: 'lobby-label' }, t('lobby.joining', { room: s.room })), h('div', { class: 'loader' }, h('i'), h('i'), h('i')));
  }

  const el = h(
    'section',
    { class: 'lobby' },
    h('header', { class: 'topbar' }, h('h2', { class: 'topbar-title' }, t('lobby.title'))),
    h('div', { class: 'panel lobby-panel' }, ...body, status),
    button(t('common.cancel'), leave, 'ghost'),
  );

  const render = () => {
    if (ctrl.core.fatal) {
      toast(t(`fatal.${ctrl.core.fatal}` as I18nKey), 'bad', 4000);
      leave();
      return;
    }
    if (ctrl.phase !== 'lobby') {
      audio.play('turn');
      vibrate([30, 40, 30]);
      app.go(gameScreen);
      return;
    }
    const st = ctrl.link;
    status.className = `lobby-status st-${st}`;
    const txt = isHost && st === 'waiting' ? t('lobby.waiting') : st === 'online' ? t('lobby.connected') : linkLabel(st, detail);
    status.querySelector('.txt')!.textContent = txt;
  };
  const prevLink = ctrl.session.onLink;
  ctrl.session.onLink = (st, d) => {
    detail = d ?? '';
    prevLink(st, d);
  };
  const off = ctrl.onChange(render);
  render();
  return {
    el,
    destroy() {
      off();
      ctrl.session.onLink = prevLink;
    },
  };
}
