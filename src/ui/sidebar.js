import { el, icon, clear } from '../dom.js';
import { labelHex, byOrder } from '../model.js';
import { SMART_VIEWS, counts, viewKey } from '../query.js';
import { makeZoneTarget } from '../dnd.js';

function navItem({ label, iconName, dot, count, current, onClick, onContextMenu, extraClass = '' }) {
  const node = el('button', {
    class: `nav-item ${extraClass}`,
    type: 'button',
    'aria-current': String(current),
    onclick: onClick,
  }, [
    dot ? el('span', { class: 'nav-item__dot', style: { background: dot } }) : icon(iconName, { size: 15 }),
    el('span', { class: 'nav-item__label', text: label }),
    count ? el('span', { class: 'nav-item__count', text: String(count) }) : null,
  ]);
  if (onContextMenu) {
    node.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      onContextMenu();
    });
  }
  return node;
}

function sectionHead(title, action) {
  return el('div', { class: 'nav-section__head' }, [
    el('span', { text: title }),
    action,
  ]);
}

export function renderSidebar(container, app) {
  clear(container);

  const data = app.data();
  const ui = app.ui();
  const c = counts(data);
  const activeKey = viewKey(ui.view);

  const isCurrent = (key) => activeKey === key;

  // --- Views ---------------------------------------------------------
  const overview = el('div', { class: 'nav-section' }, [
    navItem({
      label: 'All',
      iconName: 'layers',
      count: c.all,
      current: isCurrent('all'),
      onClick: () => app.setView({ kind: 'all' }),
    }),
    ...SMART_VIEWS.map((smart) =>
      navItem({
        label: smart.name,
        iconName: smart.icon,
        count: c.smart[smart.id],
        current: isCurrent(`smart:${smart.id}`),
        extraClass: smart.id === 'overdue' && c.smart.overdue > 0 ? 'nav-item--overdue' : '',
        onClick: () => app.setView({ kind: 'smart', id: smart.id }),
      }),
    ),
  ]);

  // Dropping on Today/Overdue sets a due date — dragging *into* a computed
  // view would otherwise be meaningless.
  const todayNode = overview.children[1];
  makeZoneTarget(todayNode, (todoId) => app.setDueToday(todoId));

  container.append(overview);

  // --- Lists ---------------------------------------------------------
  const listsSection = el('div', { class: 'nav-section' }, [
    sectionHead('Lists', el('button', {
      class: 'icon-btn',
      type: 'button',
      'aria-label': 'New list',
      title: 'New list',
      onclick: () => app.createList(),
    }, [icon('plus', { size: 14 })])),
  ]);

  for (const list of [...data.lists].sort(byOrder)) {
    const node = navItem({
      label: list.name,
      iconName: 'inbox',
      count: c.lists[list.id] || 0,
      current: isCurrent(`list:${list.id}`),
      onClick: () => app.setView({ kind: 'list', id: list.id }),
      onContextMenu: () => app.listMenu(list.id),
    });
    node.title = `${list.name} — right-click to rename or delete`;
    makeZoneTarget(node, (todoId) => app.moveToList(todoId, list.id));
    listsSection.append(node);
  }
  container.append(listsSection);

  // --- Labels --------------------------------------------------------
  const labelsSection = el('div', { class: 'nav-section' }, [
    sectionHead('Labels', el('button', {
      class: 'icon-btn',
      type: 'button',
      'aria-label': 'New label',
      title: 'New label',
      onclick: () => app.createLabel(),
    }, [icon('plus', { size: 14 })])),
  ]);

  if (data.labels.length === 0) {
    labelsSection.append(
      el('div', {
        class: 'nav-item',
        style: { color: 'var(--text-faint)', fontSize: '12.5px', cursor: 'default' },
        text: 'None yet',
      }),
    );
  }

  for (const label of [...data.labels].sort(byOrder)) {
    const node = navItem({
      label: label.name,
      dot: labelHex(data, label.id),
      count: c.labels[label.id] || 0,
      current: isCurrent(`label:${label.id}`),
      onClick: () => app.setView({ kind: 'label', id: label.id }),
      onContextMenu: () => app.labelMenu(label.id),
    });
    node.title = `${label.name} — right-click to edit or delete`;
    makeZoneTarget(node, (todoId) => app.setLabel(todoId, label.id));
    labelsSection.append(node);
  }
  container.append(labelsSection);
}

const STATUS_TEXT = {
  saved: (name) => `Saved to ${name}`,
  saving: (name) => `Saving to ${name}…`,
  error: () => 'Save failed',
  'cache-only': (name, pending) => (pending ? `Reconnect to ${name}` : 'This browser only'),
  idle: () => 'Starting…',
};

/**
 * Pure so it can be unit tested without a DOM: `pendingHandle` means a file
 * was attached in a previous session but the browser dropped permission when
 * the tab closed, and a fresh click is enough to get it back.
 */
export function saveStatusInfo({ status, fileName, pendingHandle, error }) {
  const pending = Boolean(pendingHandle);
  const name = fileName || 'file';
  const text = (STATUS_TEXT[status] || STATUS_TEXT.idle)(name, pending);

  const title =
    status === 'cache-only'
      ? pending
        ? `The browser dropped its permission to ${name} when the tab closed. Click to reconnect.`
        : 'Your todos live only in this browser. Clearing site data would lose them. Click to attach a file.'
      : status === 'error'
        ? error || 'Save failed'
        : `Every change is written straight to ${name}.`;

  return { text, title, pending };
}

export function renderSaveStatus(container, app) {
  clear(container);
  const p = app.persistence;
  const { text, title, pending } = saveStatusInfo(p);

  container.append(
    el('button', {
      class: 'save-status',
      type: 'button',
      dataset: { status: p.status },
      title,
      onclick: () => (pending ? app.reconnectFile() : app.openStorageMenu()),
    }, [
      el('span', { class: 'save-status__dot' }),
      el('span', { class: 'save-status__text', text }),
      icon('chevron', { size: 12 }),
    ]),
  );
}
