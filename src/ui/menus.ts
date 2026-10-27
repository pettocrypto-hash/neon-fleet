import type { Difficulty } from '../ai/ai';
import { audio } from '../audio/audio';
import { clearSave, createAiGame, createGuest, createHost, loadSave, resumeSave } from '../app/game-session';
import { settings, updateSettings, type Quality } from '../app/settings';
import type { GameMode } from '../config/balance';
import { t, type I18nKey } from '../i18n';
import { normalizeRoomCode } from '../net/transport';
import type { App, Screen } from './app';
import { button, glitchTitle, h, segmented, toast } from './dom';
import { gameScreen } from './game-screen';
import { icon } from './icons';
import { lobbyScreen } from './lobby';

function header(app: App, title: string, back: () => void = () => app.go(startScreen)) {
  return h(
    'header',
    { class: 'topbar' },
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('common.back'), html: icon('back'), onclick: (() => { audio.play('click'); back(); }) as EventListener }),
    h('h2', { class: 'topbar-title' }, title),
    muteButton(),
  );
}

export function muteButton() {
  const b = h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('settings.mute') });
  const render = () => (b.innerHTML = icon(settings.muted ? 'mute' : 'sound'));
  b.addEventListener('click', () => {
    updateSettings({ muted: !settings.muted });
    render();
    audio.play('click');
  });
  render();
  return b;
}

function logo() {
  return h(
    'div',
    { class: 'logo' },
    h('div', { class: 'logo-ring' }),
    glitchTitle(t('app.title'), 'logo-title'),
    h('p', { class: 'logo-sub' }, t('app.subtitle')),
  );
}

export function startScreen(app: App): Screen {
  app.setSession(null, false);
  const save = loadSave();
  const offline = !navigator.onLine;
  const needNet = (fn: () => void) => () => {
    if (!navigator.onLine) {
      toast(t('toast.offlineMp'), 'warn');
      return;
    }
    fn();
  };
  const items: HTMLElement[] = [];
  if (save) {
    items.push(
      button(
        h('span', null, t('menu.resume'), h('small', null, t('menu.resumeHint', { room: save.room, phase: t(`phase.${save.core.phase}` as I18nKey) }))),
        needNet(() => {
          const s = resumeSave(save);
          app.setSession(s);
          app.go(s.ctrl.phase === 'lobby' ? lobbyScreen : gameScreen);
        }),
        'primary resume',
      ),
    );
  }
  items.push(
    button(t('menu.create'), needNet(() => app.go(createScreen)), save ? '' : 'primary'),
    button(t('menu.join'), needNet(() => app.go((a) => joinScreen(a))), ''),
    button(t('menu.ai'), () => app.go(aiScreen), 'accent'),
    h('div', { class: 'row' }, button(t('menu.howto'), () => app.go(howtoScreen), 'ghost small'), button(t('menu.settings'), () => app.go(settingsScreen), 'ghost small')),
  );
  if (app.installPrompt) {
    const p = app.installPrompt;
    items.push(
      button(t('menu.install'), async () => {
        await p.prompt();
        app.installPrompt = null;
      }, 'ghost small install'),
    );
  }
  const el = h(
    'section',
    { class: 'start' },
    h('div', { class: 'start-top' }, muteButton()),
    logo(),
    h('nav', { class: 'menu' }, ...items),
    offline ? h('p', { class: 'note warn' }, t('menu.offline')) : null,
    h('footer', { class: 'foot' }, 'v1.0 · WebRTC P2P · PWA'),
  );
  audio.startMusic();
  return { el };
}

function modePicker(): HTMLElement {
  return h(
    'div',
    { class: 'field' },
    h('label', null, t('mode.label')),
    segmented<GameMode>(
      [
        { value: 'cyber', label: t('mode.cyber'), sub: t('mode.cyberDesc') },
        { value: 'classic', label: t('mode.classic'), sub: t('mode.classicDesc') },
      ],
      settings.mode,
      (v) => updateSettings({ mode: v }),
    ),
  );
}

function timerPicker(): HTMLElement {
  return h(
    'div',
    { class: 'field' },
    h('label', null, t('timer.label')),
    segmented<number>(
      [0, 30, 45, 60].map((n) => ({ value: n, label: n ? t('common.seconds', { n }) : t('common.off') })),
      settings.turnSeconds,
      (v) => updateSettings({ turnSeconds: v }),
    ),
  );
}

export function createScreen(app: App): Screen {
  const el = h(
    'section',
    { class: 'form-screen' },
    header(app, t('create.title')),
    h(
      'div',
      { class: 'panel form' },
      modePicker(),
      timerPicker(),
      button(t('create.open'), () => {
        clearSave();
        const s = createHost(settings.mode, settings.turnSeconds);
        app.setSession(s);
        app.go(lobbyScreen);
      }, 'primary'),
    ),
  );
  return { el };
}

export function joinScreen(app: App, preset = ''): Screen {
  const input = h('input', {
    class: 'code-input',
    maxlength: 7,
    autocomplete: 'off',
    autocapitalize: 'characters',
    spellcheck: 'false',
    placeholder: t('join.placeholder'),
    value: preset,
    inputmode: 'text',
    'aria-label': t('join.code'),
  });
  const err = h('p', { class: 'note warn hidden' }, t('join.invalid'));
  const go = () => {
    const code = normalizeRoomCode(input.value);
    if (!code) {
      err.classList.remove('hidden');
      audio.play('error');
      return;
    }
    clearSave();
    const s = createGuest(code);
    app.setSession(s);
    app.go(lobbyScreen);
  };
  input.addEventListener('input', () => {
    input.value = input.value.toUpperCase();
    err.classList.add('hidden');
  });
  input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  const el = h(
    'section',
    { class: 'form-screen' },
    header(app, t('join.title')),
    h('div', { class: 'panel form' }, h('label', { class: 'field-label' }, t('join.code')), input, err, button(t('join.connect'), go, 'primary')),
  );
  setTimeout(() => !preset && input.focus(), 300);
  return { el };
}

export function aiScreen(app: App): Screen {
  const el = h(
    'section',
    { class: 'form-screen' },
    header(app, t('ai.title')),
    h(
      'div',
      { class: 'panel form' },
      h(
        'div',
        { class: 'field' },
        h('label', null, t('ai.difficulty')),
        segmented<Difficulty>(
          (['easy', 'medium', 'hard'] as Difficulty[]).map((d) => ({ value: d, label: t(`ai.${d}` as I18nKey) })),
          settings.difficulty,
          (v) => updateSettings({ difficulty: v }),
        ),
      ),
      modePicker(),
      timerPicker(),
      button(t('ai.start'), () => {
        const s = createAiGame(settings.difficulty, settings.mode, settings.turnSeconds);
        app.setSession(s);
        app.go(gameScreen);
      }, 'primary'),
    ),
  );
  return { el };
}

export function howtoScreen(app: App): Screen {
  const el = h('section', { class: 'form-screen' }, header(app, t('howto.title')), h('div', { class: 'panel prose', html: t('howto.body') }));
  return { el };
}

export function settingsScreen(app: App): Screen {
  const name = h('input', { class: 'text-input', maxlength: 16, value: settings.name, 'aria-label': t('settings.name') });
  name.addEventListener('change', () => updateSettings({ name: name.value.trim().slice(0, 16) || 'Captain' }));
  const slider = (key: 'music' | 'sfx') => {
    const s = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: settings[key], class: 'range' });
    s.addEventListener('input', () => updateSettings({ [key]: Number(s.value) }));
    s.addEventListener('change', () => audio.play(key === 'sfx' ? 'hit' : 'select'));
    return s;
  };
  const el = h(
    'section',
    { class: 'form-screen' },
    header(app, t('settings.title')),
    h(
      'div',
      { class: 'panel form' },
      h('div', { class: 'field' }, h('label', null, t('settings.name')), name),
      h('div', { class: 'field' }, h('label', null, t('settings.music')), slider('music')),
      h('div', { class: 'field' }, h('label', null, t('settings.sfx')), slider('sfx')),
      h(
        'div',
        { class: 'field' },
        h('label', null, t('settings.mute')),
        segmented<string>([{ value: 'off', label: t('settings.off') }, { value: 'on', label: t('settings.on') }], settings.muted ? 'on' : 'off', (v) => updateSettings({ muted: v === 'on' })),
      ),
      h(
        'div',
        { class: 'field' },
        h('label', null, t('settings.quality')),
        segmented<Quality>(
          (['low', 'medium', 'high'] as Quality[]).map((q) => ({ value: q, label: t(`settings.q.${q}` as I18nKey) })),
          settings.quality,
          (v) => {
            updateSettings({ quality: v });
            document.documentElement.dataset.quality = v;
          },
        ),
      ),
      h(
        'div',
        { class: 'field' },
        h('label', null, t('settings.vibrate')),
        segmented<string>([{ value: 'on', label: t('settings.on') }, { value: 'off', label: t('settings.off') }], settings.vibrate ? 'on' : 'off', (v) => updateSettings({ vibrate: v === 'on' })),
      ),
      h(
        'div',
        { class: 'field' },
        h('label', null, t('settings.language')),
        segmented<string>([{ value: 'de', label: 'Deutsch' }], settings.lang, (v) => updateSettings({ lang: v })),
      ),
    ),
  );
  return { el };
}
