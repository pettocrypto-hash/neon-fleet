import { audio } from '../audio/audio';
import { vibrate } from '../app/settings';

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | EventListener | undefined | null> & {
  class?: string;
};

/** Minimaler DOM-Baukasten. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k === 'class') el.className = String(v);
      else if (k === 'html') el.innerHTML = String(v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

/** Neon-Button mit Klick-Sound und Haptik. */
export function button(label: string | Node, onClick: () => void, cls = '', attrs: Attrs = {}): HTMLButtonElement {
  return h(
    'button',
    {
      class: `btn ${cls}`,
      type: 'button',
      ...attrs,
      onclick: ((e: Event) => {
        const b = e.currentTarget as HTMLButtonElement;
        if (b.disabled) return;
        audio.play('click');
        vibrate(8);
        onClick();
      }) as EventListener,
    },
    label,
  );
}

let toastHost: HTMLElement | null = null;

export function toast(text: string, kind: 'info' | 'good' | 'bad' | 'warn' = 'info', ms = 2200) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts' });
    document.body.appendChild(toastHost);
  }
  const el = h('div', { class: `toast toast-${kind}` }, text);
  toastHost.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 400);
  }, ms);
}

export function confirmDialog(text: string, yes: string, no: string): Promise<boolean> {
  return new Promise((resolve) => {
    const close = (v: boolean) => {
      wrap.remove();
      resolve(v);
    };
    const wrap = h(
      'div',
      { class: 'modal-wrap' },
      h('div', { class: 'modal panel' }, h('p', { class: 'modal-text' }, text), h('div', { class: 'row' }, button(no, () => close(false), 'ghost'), button(yes, () => close(true), 'danger'))),
    );
    document.body.appendChild(wrap);
  });
}

/** Segmentierte Auswahl (z. B. Modus, Schwierigkeit). */
export function segmented<T extends string | number>(options: { value: T; label: string; sub?: string }[], value: T, onChange: (v: T) => void): HTMLElement {
  const wrap = h('div', { class: 'seg' });
  const render = (cur: T) => {
    wrap.replaceChildren(
      ...options.map((o) =>
        h(
          'button',
          {
            type: 'button',
            class: `seg-btn ${o.value === cur ? 'active' : ''}`,
            onclick: (() => {
              audio.play('select');
              vibrate(6);
              render(o.value);
              onChange(o.value);
            }) as EventListener,
          },
          h('span', { class: 'seg-label' }, o.label),
          o.sub ? h('span', { class: 'seg-sub' }, o.sub) : null,
        ),
      ),
    );
  };
  render(value);
  return wrap;
}

export function glitchTitle(text: string, cls = ''): HTMLElement {
  return h('h1', { class: `glitch ${cls}`, 'data-text': text }, text);
}

export function flash(kind: 'hit' | 'good' | 'emp') {
  const el = h('div', { class: `screen-flash flash-${kind}` });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 600);
}

export function glitchScreen() {
  document.body.classList.remove('glitching');
  void document.body.offsetWidth;
  document.body.classList.add('glitching');
  setTimeout(() => document.body.classList.remove('glitching'), 450);
}
