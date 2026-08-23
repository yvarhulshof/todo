import { el, icon, clear, $ } from './dom.js';
import { Store } from './store.js';
import { Persistence, exportBlob, parseImport, supportsFileSystem, listSnapshots } from './persist.js';
import {
  addTodo, updateTodo, deleteTodo, setCompleted, moveTodo,
  addList, renameList, deleteList, addLabel, updateLabel, deleteLabel,
} from './model.js';
import { today } from './dates.js';
import {
  selectView, parseViewKey, viewKey, viewTitle, getOptions, canReorder, isSmart,
  targetListId, targetDueDate, targetLabelId,
} from './query.js';
import { parseQuickAdd } from './quickadd.js';
import { renderSidebar, renderSaveStatus } from './ui/sidebar.js';
import { renderList } from './ui/list.js';
import { showToast } from './ui/toast.js';
import {
  confirmDialog, promptDialog, deleteListDialog, labelDialog,
  listSettingsDialog, labelSettingsDialog, openDialog,
} from './ui/dialog.js';
import { dragState } from './dnd.js';

// ============================================================ boot

const persistence = new Persistence();
const data = await persistence.init();
const store = new Store(data, persistence);

store.ui.view = parseViewKey(data.prefs.lastView, data) || { kind: 'all' };

// ============================================================ theme

function applyTheme() {
  const theme = store.data.prefs.theme || 'auto';
  if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

function cycleTheme() {
  const order = ['auto', 'light', 'dark'];
  const next = order[(order.indexOf(store.data.prefs.theme || 'auto') + 1) % order.length];
  store.setPref({ theme: next });
  applyTheme();
}

// ============================================================ actions

const app = {
  persistence,
  data: () => store.data,
  ui: () => store.ui,

  setView(view) {
    store.setUI({ view, selectedId: null, editingId: null, completedOpen: false });
    store.setPref({ lastView: viewKey(view) });
    closeSidebarOnNarrow();
  },

  select(id) {
    if (store.ui.selectedId === id) return;
    store.setUI({ selectedId: id }, { silent: true });
    applySelectionClass(id);
  },

  startEdit(id) {
    store.setUI({ editingId: id, selectedId: id });
  },

  cancelEdit() {
    store.setUI({ editingId: null });
    focusSelected();
  },

  saveEdit(id, patch) {
    store.commit((d) => updateTodo(d, id, patch), { undoLabel: 'Edit' });
    store.setUI({ editingId: null });
    focusSelected();
  },

  toggleComplete(id) {
    const todo = store.data.todos.find((t) => t.id === id);
    if (!todo) return;
    const completing = !todo.completedAt;
    store.commit((d) => setCompleted(d, id, completing), { undoLabel: completing ? 'Complete' : 'Reopen' });
  },

  removeTodo(id) {
    const todo = store.data.todos.find((t) => t.id === id);
    if (!todo) return;
    const title = todo.title;
    store.commit((d) => deleteTodo(d, id), { undoLabel: 'Delete' });
    store.setUI({ editingId: null, selectedId: null });
    showToast(`Deleted "${truncate(title)}"`, { actionLabel: 'Undo', onAction: () => store.undo() });
  },

  reorder(draggedId, beforeId) {
    const selection = currentSelection();
    const orderedIds = selection.open.map((t) => t.id);
    const target = beforeId ? store.data.todos.find((t) => t.id === beforeId) : null;
    // Dropping onto a row in a different list adopts that list.
    const listId = target ? target.listId : null;
    const patch = { beforeId, orderedIds, listId };
    // In the label-grouped view, dropping onto a row also adopts that row's
    // label — the whole section is the relabel target, not just its header.
    if (target && selection.options.group === 'label') patch.labelId = target.labelId;
    store.commit((d) => moveTodo(d, draggedId, patch), {
      undoLabel: 'Move',
    });
  },

  moveToList(todoId, listId) {
    const todo = store.data.todos.find((t) => t.id === todoId);
    if (!todo || todo.listId === listId) return;
    const list = store.data.lists.find((l) => l.id === listId);
    store.commit((d) => {
      const max = d.todos.filter((t) => t.listId === listId).reduce((m, t) => Math.max(m, t.order), 0);
      const moved = d.todos.find((t) => t.id === todoId);
      moved.listId = listId;
      moved.order = max + 1024;
    }, { undoLabel: 'Move' });
    showToast(`Moved to ${list.name}`, { actionLabel: 'Undo', onAction: () => store.undo(), duration: 4000 });
  },

  setLabel(todoId, labelId) {
    const todo = store.data.todos.find((t) => t.id === todoId);
    if (!todo || todo.labelId === labelId) return;
    store.commit((d) => updateTodo(d, todoId, { labelId }), { undoLabel: 'Label' });
  },

  setDueToday(todoId) {
    const todo = store.data.todos.find((t) => t.id === todoId);
    if (!todo) return;
    store.commit((d) => updateTodo(d, todoId, { dueDate: today() }), { undoLabel: 'Due date' });
    showToast('Due today', { actionLabel: 'Undo', onAction: () => store.undo(), duration: 4000 });
  },

  toggleCompleted() {
    store.setUI({ completedOpen: !store.ui.completedOpen });
  },

  // --- lists ---------------------------------------------------------
  async createList() {
    const name = await promptDialog({
      title: 'New list',
      label: 'Name',
      placeholder: 'Today, Work, Someday…',
      confirmLabel: 'Create list',
    });
    if (!name) return;
    if (isReservedName(name)) {
      const proceed = await confirmDialog({
        title: `Call it "${name}"?`,
        description:
          'There is already a built-in Today view driven by due dates. Two things called Today tend to disagree with each other.',
        confirmLabel: 'Create it anyway',
        danger: false,
      });
      if (!proceed) return;
    }
    const list = store.commit((d) => addList(d, name), { undoLabel: 'New list' });
    if (list) app.setView({ kind: 'list', id: list.id });
  },

  async listMenu(id) {
    const list = store.data.lists.find((l) => l.id === id);
    if (!list) return;
    const todoCount = store.data.todos.filter((t) => t.listId === id).length;
    const otherLists = store.data.lists.filter((l) => l.id !== id);

    const result = await listSettingsDialog({ list, otherLists, todoCount });
    if (!result) return;

    if (result.action === 'rename') {
      store.commit((d) => renameList(d, id, result.name), { undoLabel: 'Rename list' });
      return;
    }

    const choice = await deleteListDialog({ list, otherLists, todoCount });
    if (!choice) return;
    const wasCurrent = viewKey(store.ui.view) === `list:${id}`;
    store.commit((d) => deleteList(d, id, choice), { undoLabel: 'Delete list' });
    if (wasCurrent) app.setView({ kind: 'all' });
    showToast(
      choice.reassignTo ? `Deleted "${list.name}", todos moved` : `Deleted "${list.name}" and its todos`,
      { actionLabel: 'Undo', onAction: () => store.undo() },
    );
  },

  // --- labels --------------------------------------------------------
  async createLabel() {
    const result = await labelDialog({ title: 'New label' });
    if (!result) return;
    store.commit((d) => addLabel(d, result.name, result.color), { undoLabel: 'New label' });
  },

  async labelMenu(id) {
    const label = store.data.labels.find((l) => l.id === id);
    if (!label) return;
    const todoCount = store.data.todos.filter((t) => t.labelId === id).length;

    const result = await labelSettingsDialog({ label, todoCount });
    if (!result) return;

    if (result.action === 'save') {
      store.commit((d) => updateLabel(d, id, { name: result.name, color: result.color }), {
        undoLabel: 'Edit label',
      });
      return;
    }

    const wasCurrent = viewKey(store.ui.view) === `label:${id}`;
    store.commit((d) => deleteLabel(d, id), { undoLabel: 'Delete label' });
    if (wasCurrent) app.setView({ kind: 'all' });
    showToast(`Deleted label "${label.name}"`, { actionLabel: 'Undo', onAction: () => store.undo() });
  },

  // --- storage -------------------------------------------------------
  openStorageMenu: () => storageMenu(),
};

function truncate(text, max = 42) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function isReservedName(name) {
  return ['today', 'upcoming', 'overdue', 'all'].includes(name.trim().toLowerCase());
}

function currentSelection() {
  return selectView(store.data, store.ui.view, { search: store.ui.search });
}

// ============================================================ quick add

const quickInput = el('input', {
  type: 'text',
  placeholder: 'Add a todo — try "Review deck fri #urgent"',
  'aria-label': 'Add a todo',
  autocomplete: 'off',
  maxLength: 500,
});

const chipRow = el('div', { class: 'chips', hidden: true });

const quickAddNode = el('div', { class: 'quickadd' }, [
  el('div', { class: 'quickadd__field' }, [
    icon('plus', { size: 16 }),
    quickInput,
    el('span', { class: 'quickadd__hint', text: 'n' }),
  ]),
  chipRow,
]);

function renderChips() {
  const parsed = parseQuickAdd(quickInput.value, store.data.labels);
  clear(chipRow);
  if (!parsed.chips.length || !quickInput.value.trim()) {
    chipRow.hidden = true;
    return;
  }
  chipRow.hidden = false;
  for (const chip of parsed.chips) {
    const text =
      chip.type === 'date'
        ? chip.value
        : chip.type === 'new-label'
          ? `new label: ${chip.text}`
          : chip.text;
    chipRow.append(el('span', { class: `chip chip--${chip.type}` }, [
      icon(chip.type === 'date' ? 'calendar' : 'tag', { size: 11 }),
      text,
    ]));
  }
}

function submitQuickAdd() {
  const raw = quickInput.value;
  if (!raw.trim()) return;
  const parsed = parseQuickAdd(raw, store.data.labels);
  if (!parsed.title) return;

  const view = store.ui.view;
  store.commit((d) => {
    let labelId = parsed.labelId ?? targetLabelId(view);
    if (parsed.newLabelName) labelId = addLabel(d, parsed.newLabelName)?.id ?? null;
    addTodo(d, {
      title: parsed.title,
      listId: targetListId(view, d),
      labelId,
      dueDate: parsed.dueDate ?? targetDueDate(view),
    });
  }, { undoLabel: 'Add' });

  quickInput.value = '';
  renderChips();
}

quickInput.addEventListener('input', renderChips);
quickInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    submitQuickAdd();
  } else if (event.key === 'Escape') {
    quickInput.value = '';
    renderChips();
    quickInput.blur();
  }
});

// ============================================================ topbar

const searchInput = el('input', {
  type: 'search',
  placeholder: 'Search',
  'aria-label': 'Search todos',
  autocomplete: 'off',
});
searchInput.id = 'search-input';

searchInput.addEventListener('input', () => {
  store.setUI({ search: searchInput.value }, { silent: true });
  renderListOnly();
});

searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    searchInput.value = '';
    store.setUI({ search: '' }, { silent: true });
    renderListOnly();
    searchInput.blur();
  }
});

const titleNode = el('h1', { class: 'topbar__title' });
const countNode = el('span', { class: 'topbar__count' });

const groupButtons = [
  el('button', { type: 'button', onclick: () => setViewOption({ group: 'none' }) }, ['Flat']),
  el('button', { type: 'button', onclick: () => setViewOption({ group: 'label' }) }, ['By label']),
];

const sortButtons = [
  el('button', { type: 'button', onclick: () => setViewOption({ sort: 'manual' }) }, ['Manual']),
  el('button', { type: 'button', onclick: () => setViewOption({ sort: 'due' }) }, ['By date']),
];

function buildTopbar(container) {
  container.append(
    el('button', {
      class: 'icon-btn menu-btn',
      type: 'button',
      'aria-label': 'Toggle sidebar',
      onclick: () => $('#app').classList.toggle('is-sidebar-open'),
    }, [icon('layers', { size: 16 })]),
    titleNode,
    countNode,
    el('span', { class: 'topbar__spacer' }),
    el('div', { class: 'search' }, [icon('search', { size: 14 }), searchInput]),
    el('div', { class: 'seg', role: 'group', 'aria-label': 'Grouping' }, groupButtons),
    el('div', { class: 'seg', role: 'group', 'aria-label': 'Sorting' }, sortButtons),
  );
}

function updateTopbar(selection) {
  const view = store.ui.view;
  const options = getOptions(store.data, view);

  titleNode.textContent = viewTitle(view, store.data);
  countNode.textContent = String(selection.openCount);

  groupButtons[0].setAttribute('aria-pressed', String(options.group === 'none'));
  groupButtons[1].setAttribute('aria-pressed', String(options.group === 'label'));

  sortButtons[0].setAttribute('aria-pressed', String(options.sort === 'manual'));
  sortButtons[1].setAttribute('aria-pressed', String(options.sort === 'due'));
  sortButtons[0].disabled = isSmart(view);
  sortButtons[0].title = isSmart(view)
    ? 'Computed views are always sorted by date'
    : 'Drag to arrange';
  sortButtons[1].setAttribute('aria-pressed', String(options.sort === 'due'));
}

function setViewOption(patch) {
  const key = viewKey(store.ui.view);
  const viewOptions = { ...(store.data.prefs.viewOptions || {}) };
  viewOptions[key] = { ...getOptions(store.data, store.ui.view), ...patch };
  store.setPref({ viewOptions });
}

// ============================================================ storage menu

function storageMenu() {
  const p = persistence;

  return openDialog({
    title: 'Where your todos are stored',
    hideConfirm: true,
    cancelLabel: 'Close',
    body: (close) => {
      const rows = [];

      rows.push(
        el('p', { class: 'dialog__desc' }, [
          p.fileBacked
            ? `Every change is written straight to ${p.fileName}. Clearing your browser data will not lose anything.`
            : 'Your todos currently live only in this browser. Clearing site data, a browser policy that wipes on exit, or a machine reimage would lose them.',
        ]),
      );

      if (!supportsFileSystem) {
        rows.push(el('p', { class: 'dialog__desc' }, [
          'This browser has not exposed the File System Access API needed for file-backed saving. Most Chromium-based browsers support it — Chrome, Edge, Brave, Opera, Vivaldi — while Firefox and Safari do not. Export a copy regularly as a backup either way.',
        ]));
      }

      if (p.pendingHandle) {
        rows.push(el('button', {
          class: 'btn btn--primary',
          type: 'button',
          onclick: async () => {
            const restored = await p.reconnect();
            if (restored) store.replace(restored);
            render();
            close(null);
          },
        }, [`Reconnect to ${p.fileName}`]));
      }

      if (supportsFileSystem && !p.fileBacked) {
        rows.push(
          el('button', {
            class: 'btn btn--primary',
            type: 'button',
            onclick: async () => {
              try {
                await p.attachNew(store.data, 'todo-data.json');
                showToast(`Now saving to ${p.fileName}`);
              } catch (err) {
                if (err.name !== 'AbortError') showToast(`Could not attach file: ${err.message}`);
              }
              render();
              close(null);
            },
          }, ['Save to a file…']),
          el('button', {
            class: 'btn',
            type: 'button',
            onclick: async () => {
              try {
                const { data: fromFile } = await p.attachExisting();
                if (fromFile) store.replace(fromFile, { undoLabel: 'Open file' });
                showToast(`Opened ${p.fileName}`);
              } catch (err) {
                if (err.name !== 'AbortError') showToast(`Could not open file: ${err.message}`);
              }
              render();
              close(null);
            },
          }, ['Open an existing file…']),
          el('p', { class: 'dialog__desc' }, [
            'Tip: put the file in your OneDrive folder. You then get sync, version history and backup from storage your employer already manages.',
          ]),
        );
      }

      if (p.fileBacked) {
        rows.push(el('button', {
          class: 'btn',
          type: 'button',
          onclick: async () => {
            await p.detach();
            render();
            close(null);
          },
        }, ['Stop saving to this file']));
      }

      rows.push(
        el('div', { style: { height: '1px', background: 'var(--border)', margin: '4px 0' } }),
        el('button', { class: 'btn', type: 'button', onclick: () => exportCopy() }, ['Export a copy']),
        el('button', { class: 'btn', type: 'button', onclick: () => importCopy(close) }, ['Import from a file…']),
      );

      const snaps = listSnapshots();
      if (snaps.length) {
        rows.push(el('p', { class: 'dialog__desc' }, [
          `${snaps.length} local ${snaps.length === 1 ? 'snapshot' : 'snapshots'} kept for recovery, oldest from ${new Date(snaps[0].at).toLocaleString()}.`,
        ]));
      }

      return rows;
    },
  });
}

function exportCopy() {
  const url = URL.createObjectURL(exportBlob(store.data));
  const a = el('a', { href: url, download: `todo-${today()}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function importCopy(close) {
  const input = el('input', { type: 'file', accept: 'application/json,.json' });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const imported = parseImport(await file.text());
      const ok = await confirmDialog({
        title: 'Replace everything?',
        description: `This replaces your current ${store.data.todos.length} todos with the ${imported.todos.length} in that file. Undo will bring them back.`,
        confirmLabel: 'Replace',
      });
      if (!ok) return;
      store.replace(imported, { undoLabel: 'Import' });
      showToast('Imported', { actionLabel: 'Undo', onAction: () => store.undo() });
      close?.(null);
    } catch (err) {
      showToast(`Import failed: ${err.message}`);
    }
  });
  input.click();
}

// ============================================================ keyboard

function focusSelected() {
  requestAnimationFrame(() => {
    const id = store.ui.selectedId;
    if (!id) return;
    document.querySelector(`.todo[data-id="${CSS.escape(id)}"]`)?.focus();
  });
}

function visibleIds() {
  return [...document.querySelectorAll('.todo[data-id]')].map((n) => n.dataset.id);
}

function moveSelection(delta) {
  const ids = visibleIds();
  if (!ids.length) return;
  const i = ids.indexOf(store.ui.selectedId);
  const next = i === -1 ? (delta > 0 ? 0 : ids.length - 1) : Math.min(ids.length - 1, Math.max(0, i + delta));
  store.setUI({ selectedId: ids[next] }, { silent: true });
  document.querySelector(`.todo[data-id="${CSS.escape(ids[next])}"]`)?.focus();
  document.querySelectorAll('.todo.is-selected').forEach((n) => n.classList.remove('is-selected'));
  document.querySelector(`.todo[data-id="${CSS.escape(ids[next])}"]`)?.classList.add('is-selected');
}

/** Keyboard reordering. Dragging is slow and unusable without a mouse. */
function nudgeSelected(delta) {
  const selection = currentSelection();
  if (!canReorder(store.ui.view, selection.options)) {
    showToast('Switch to Manual sorting to rearrange todos', { duration: 3000 });
    return;
  }
  const ids = selection.open.map((t) => t.id);
  const i = ids.indexOf(store.ui.selectedId);
  if (i === -1) return;
  const target = i + delta;
  if (target < 0 || target >= ids.length) return;

  // Moving down means landing before the item *after* the one we swap with.
  const beforeId = delta < 0 ? ids[target] : (ids[target + 1] ?? null);
  store.commit((d) => moveTodo(d, store.ui.selectedId, { beforeId, orderedIds: ids }), {
    undoLabel: 'Move',
  });
  focusSelected();
}

function isTyping(target) {
  return target.matches('input, textarea, select') || target.isContentEditable;
}

document.addEventListener('keydown', (event) => {
  const typing = isTyping(event.target);
  const mod = event.metaKey || event.ctrlKey;

  if (mod && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    const label = event.shiftKey ? store.redo() : store.undo();
    if (label) showToast(event.shiftKey ? `Redid: ${label}` : `Undid: ${label}`, { duration: 3000 });
    return;
  }

  if (typing || document.querySelector('dialog[open]')) return;

  switch (event.key) {
    case 'n':
      event.preventDefault();
      quickInput.focus();
      break;
    case '/':
      event.preventDefault();
      $('#search-input')?.focus();
      break;
    case 'ArrowDown':
      event.preventDefault();
      if (event.altKey) nudgeSelected(1);
      else moveSelection(1);
      break;
    case 'ArrowUp':
      event.preventDefault();
      if (event.altKey) nudgeSelected(-1);
      else moveSelection(-1);
      break;
    case ' ':
      if (store.ui.selectedId) {
        event.preventDefault();
        app.toggleComplete(store.ui.selectedId);
      }
      break;
    case 'e':
    case 'Enter':
      if (store.ui.selectedId) {
        event.preventDefault();
        app.startEdit(store.ui.selectedId);
      }
      break;
    case 'Backspace':
    case 'Delete':
      if (store.ui.selectedId) {
        event.preventDefault();
        app.removeTodo(store.ui.selectedId);
      }
      break;
    case 'Escape':
      store.setUI({ selectedId: null });
      break;
    default:
      break;
  }
});

// ============================================================ render

const sidebarNav = $('#sidebar-nav');
const saveStatusHost = $('#save-status');
const topbarHost = $('#topbar');
const listHost = $('#list');
const contentHost = $('#content');

contentHost.prepend(quickAddNode);
buildTopbar(topbarHost);

function applySelectionClass(id) {
  document.querySelectorAll('.todo.is-selected').forEach((n) => n.classList.remove('is-selected'));
  if (id) document.querySelector(`.todo[data-id="${CSS.escape(id)}"]`)?.classList.add('is-selected');
}

/** List only — used while typing in search, so the input keeps focus. */
function renderListOnly() {
  const selection = currentSelection();
  countNode.textContent = String(selection.openCount);
  renderList(listHost, app, selection);
}

function renderMain() {
  const selection = currentSelection();
  updateTopbar(selection);
  renderList(listHost, app, selection);
}

function render() {
  // Re-rendering mid-drag would destroy the node being dragged.
  if (dragState.todoId) return;
  if (searchInput.value !== store.ui.search) searchInput.value = store.ui.search;
  renderSidebar(sidebarNav, app);
  renderSaveStatus(saveStatusHost, app);
  renderMain();
}

function closeSidebarOnNarrow() {
  $('#app').classList.remove('is-sidebar-open');
}

store.subscribe(render);

// A drag that ends without a drop leaves the view unrendered, because renders
// are suppressed for the duration of the drag. Repaint once it is over.
document.addEventListener('dragend', () => {
  dragState.todoId = null;
  render();
});
persistence.addEventListener('status', () => renderSaveStatus(saveStatusHost, app));

$('#theme-toggle').addEventListener('click', cycleTheme);

// Warn before losing unsaved work when nothing is file-backed and a write to
// localStorage has failed. Silent in the normal case.
window.addEventListener('beforeunload', (event) => {
  if (persistence.status === 'error') {
    event.preventDefault();
    event.returnValue = '';
  }
});

// A tab left open past midnight would otherwise show a stale "Today".
let lastDay = today();
setInterval(() => {
  const now = today();
  if (now !== lastDay && !store.ui.editingId) {
    lastDay = now;
    render();
  }
}, 60000);

applyTheme();
render();

if (!persistence.fileBacked && supportsFileSystem && store.data.todos.length === 0) {
  showToast('Your todos live in this browser only. Attach a file to keep them safe.', {
    actionLabel: 'Set up',
    onAction: () => storageMenu(),
    duration: 12000,
  });
}
