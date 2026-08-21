import { el, icon } from '../dom.js';

const DEFAULT_MS = 8000;

let host = null;

function ensureHost() {
  if (!host) {
    host = el('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(host);
  }
  return host;
}

/**
 * Every destructive action gets one of these with an Undo button. The
 * keyboard shortcut works regardless — the toast is the discoverable path,
 * not the only one.
 */
export function showToast(text, { actionLabel = null, onAction = null, duration = DEFAULT_MS } = {}) {
  const node = el('div', { class: 'toast' }, [
    el('span', { class: 'toast__text', text }),
    actionLabel &&
      el('button', {
        class: 'toast__action',
        type: 'button',
        onclick: () => {
          onAction?.();
          dismiss();
        },
      }, [actionLabel]),
    el('button', {
      class: 'icon-btn',
      type: 'button',
      'aria-label': 'Dismiss',
      onclick: () => dismiss(),
    }, [icon('x', { size: 14 })]),
  ]);

  let timer = setTimeout(dismiss, duration);

  function dismiss() {
    clearTimeout(timer);
    node.remove();
  }

  // Don't yank the undo button away while the pointer is on it.
  node.addEventListener('mouseenter', () => clearTimeout(timer));
  node.addEventListener('mouseleave', () => {
    timer = setTimeout(dismiss, 2500);
  });

  ensureHost().append(node);
  return dismiss;
}
