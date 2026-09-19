import { el, icon, clear } from '../dom.js';
import { labelHex } from '../model.js';
import { formatDue, dueTone, today } from '../dates.js';
import { canReorder, isSmart } from '../query.js';
import {
  makeDraggable, makeReorderTarget, makeZoneTarget, makeGroupDraggable, makeGroupReorderTarget,
} from '../dnd.js';

function labelChip(data, labelId) {
  const label = data.labels.find((l) => l.id === labelId);
  if (!label) return null;
  return el('span', { class: 'label-chip' }, [
    el('span', { class: 'label-chip__dot', style: { background: labelHex(data, labelId) } }),
    el('span', { class: 'label-chip__name', text: label.name }),
  ]);
}

function dueChip(dueDate) {
  const tone = dueTone(dueDate);
  return el('span', {
    class: 'due',
    dataset: { tone },
    title: dueDate,
  }, [formatDue(dueDate)]);
}

// ------------------------------------------------------------- inline editor

function buildEditor(app, todo) {
  const data = app.data();

  const title = el('input', {
    class: 'editor__title',
    type: 'text',
    value: todo.title,
    maxLength: 500,
    'aria-label': 'Title',
  });

  const note = el('textarea', {
    rows: 2,
    placeholder: 'Add a note',
    maxLength: 2000,
    'aria-label': 'Note',
  });
  note.value = todo.note || '';

  const due = el('input', { type: 'date', value: todo.dueDate || '', 'aria-label': 'Due date' });

  const listSelect = el('select', { 'aria-label': 'List' },
    data.lists.map((l) => el('option', { value: l.id, text: l.name, selected: l.id === todo.listId })));

  const labelSelect = el('select', { 'aria-label': 'Label' }, [
    el('option', { value: '', text: 'No label', selected: !todo.labelId }),
    ...data.labels.map((l) =>
      el('option', { value: l.id, text: l.name, selected: l.id === todo.labelId })),
  ]);

  function save() {
    app.saveEdit(todo.id, {
      title: title.value,
      note: note.value.trim(),
      dueDate: due.value || null,
      listId: listSelect.value,
      labelId: labelSelect.value || null,
    });
  }

  const editor = el('div', { class: 'editor' }, [
    title,
    note,
    el('div', { class: 'editor__row' }, [
      due,
      listSelect,
      labelSelect,
      el('span', { style: { flex: '1' } }),
      el('button', { class: 'btn btn--danger', type: 'button', onclick: () => app.removeTodo(todo.id) },
        ['Delete']),
      el('button', { class: 'btn', type: 'button', onclick: () => app.cancelEdit() }, ['Cancel']),
      el('button', { class: 'btn btn--primary', type: 'button', onclick: save }, ['Save']),
    ]),
  ]);

  editor.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      app.cancelEdit();
    } else if (event.key === 'Enter' && event.target === title) {
      event.preventDefault();
      save();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      save();
    }
  });

  // Focus the title without scrolling the caret to the start of the text.
  requestAnimationFrame(() => {
    title.focus();
    title.setSelectionRange(title.value.length, title.value.length);
  });

  return editor;
}

// ------------------------------------------------------------------ one row

function buildRow(app, todo, { nextId, reorderable, showListTag, showLabel = true, completed = false }) {
  const data = app.data();
  const ui = app.ui();
  const editing = ui.editingId === todo.id;

  const row = el('li', {
    class: `todo${ui.selectedId === todo.id && !editing ? ' is-selected' : ''}`,
    dataset: { id: todo.id },
    tabIndex: editing ? -1 : 0,
    role: 'listitem',
  });

  if (!editing) {
    row.append(
      el('span', {
        class: 'todo__grip',
        'aria-hidden': 'true',
        style: reorderable ? {} : { visibility: 'hidden' },
      }, [icon('grip', { size: 14 })]),
    );
  }

  row.append(
    el('button', {
      class: 'check',
      type: 'button',
      role: 'checkbox',
      'aria-checked': String(Boolean(todo.completedAt)),
      'aria-label': todo.completedAt ? `Mark "${todo.title}" as not done` : `Complete "${todo.title}"`,
      onclick: (event) => {
        event.stopPropagation();
        app.toggleComplete(todo.id);
      },
    }, [icon('check', { size: 12 })]),
  );

  if (editing) {
    row.append(el('div', { class: 'todo__body' }, [buildEditor(app, todo)]));
    return row;
  }

  const meta = [];
  // Inside a label group the chip would just repeat the heading.
  if (todo.labelId && showLabel) meta.push(labelChip(data, todo.labelId));
  if (todo.dueDate && !completed) meta.push(dueChip(todo.dueDate));
  if (showListTag) {
    const list = data.lists.find((l) => l.id === todo.listId);
    if (list) meta.push(el('span', { class: 'todo__list-tag', text: list.name }));
  }

  row.append(
    el('div', { class: 'todo__body' }, [
      el('span', {
        class: 'todo__title',
        text: todo.title,
        onclick: () => app.startEdit(todo.id),
      }),
      todo.note && el('div', { class: 'todo__note', text: todo.note }),
      meta.length ? el('div', { class: 'todo__meta' }, meta) : null,
    ]),
    el('div', { class: 'todo__actions' }, [
      el('button', {
        class: 'icon-btn',
        type: 'button',
        'aria-label': `Delete "${todo.title}"`,
        onclick: (event) => {
          event.stopPropagation();
          app.removeTodo(todo.id);
        },
      }, [icon('trash', { size: 14 })]),
    ]),
  );

  row.addEventListener('focus', () => app.select(todo.id));
  row.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    app.select(todo.id);
  });
  row.addEventListener('dblclick', () => app.startEdit(todo.id));

  // Reordering by hand only makes sense for manual, non-smart views (see
  // `canReorder`), but the row itself must stay draggable everywhere open
  // todos are shown — that's how a todo moves to a different list, label, or
  // Today from views like Upcoming/Overdue where `reorderable` is false.
  makeDraggable(row, todo.id, !completed);
  if (reorderable) {
    makeReorderTarget(row, todo.id, nextId, (draggedId, beforeId) =>
      app.reorder(draggedId, beforeId));
  }

  return row;
}

// ----------------------------------------------------------- empty states

function emptyState(view, search) {
  if (search) {
    return el('div', { class: 'empty' }, [
      el('div', { class: 'empty__mark' }, [icon('search', { size: 20 })]),
      el('div', { class: 'empty__title', text: 'No matches' }),
      el('div', { class: 'empty__hint', text: `Nothing here matches "${search}".` }),
    ]);
  }

  const copy = {
    today: ['Nothing due today', 'Todos due today, and anything overdue, land here.'],
    upcoming: ['Nothing scheduled', 'Todos with a future due date appear here.'],
    overdue: ['Nothing overdue', "You're on top of it."],
  };
  const [titleText, hintText] = isSmart(view)
    ? copy[view.id]
    : ['No todos here', 'Add one above.'];

  return el('div', { class: 'empty' }, [
    el('div', { class: 'empty__mark' }, [icon(isSmart(view) ? 'calendar' : 'inbox', { size: 20 })]),
    el('div', { class: 'empty__title', text: titleText }),
    el('div', { class: 'empty__hint' }, [
      hintText,
      !isSmart(view) && ' Press ',
      !isSmart(view) && el('kbd', { text: 'n' }),
      !isSmart(view) && ' to start.',
    ]),
  ]);
}

// -------------------------------------------------------------- the section

export function renderList(container, app, selection) {
  clear(container);

  const ui = app.ui();
  const view = ui.view;
  const data = app.data();
  const options = selection.options;
  const reorderable = canReorder(view, options);
  const showListTag = view.kind !== 'list';
  const grouped = options.group === 'label';

  if (selection.openCount === 0 && selection.completed.length === 0) {
    container.append(emptyState(view, ui.search));
    return;
  }

  selection.groups.forEach((group, gi) => {
    if (grouped && group.todos.length === 0 && group.id === null) return;

    const groupNode = el('div', { class: 'group' });

    if (grouped) {
      const head = el('div', { class: 'group__head' }, [
        // "No label" is a computed placeholder, always pinned last — it has
        // no `order` of its own, so it cannot be dragged.
        group.id
          ? el('span', { class: 'group__grip', 'aria-hidden': 'true' }, [icon('grip', { size: 14 })])
          : null,
        group.color
          ? el('span', {
              class: 'label-chip__dot',
              style: { background: labelHex(data, group.id) },
            })
          : null,
        group.name,
        el('span', { class: 'group__count', text: String(group.todos.length) }),
      ]);
      groupNode.append(head);
      // Dropping onto a group header is how you relabel without a menu.
      makeZoneTarget(groupNode, (draggedId) => app.setLabel(draggedId, group.id));
      if (group.id) {
        const nextGroupId = selection.groups[gi + 1]?.id ?? null;
        makeGroupDraggable(head, group.id, true);
        makeGroupReorderTarget(head, group.id, nextGroupId, (draggedId, beforeId) =>
          app.reorderLabel(draggedId, beforeId));
      }
    }

    const ul = el('ul', { class: 'todo-list', role: 'list' });
    group.todos.forEach((todo, i) => {
      const nextId = group.todos[i + 1]?.id ?? null;
      ul.append(buildRow(app, todo, { nextId, reorderable, showListTag, showLabel: !grouped }));
    });

    if (grouped && group.todos.length === 0) {
      ul.append(el('li', {
        class: 'empty__hint',
        style: { padding: '6px 10px', color: 'var(--text-faint)' },
        text: 'Drop a todo here to give it this label',
      }));
    }

    groupNode.append(ul);
    container.append(groupNode);
  });

  if (selection.openCount === 0 && ui.search) {
    container.append(emptyState(view, ui.search));
  }

  // ------------------------------------------------------------ completed
  if (selection.completed.length) {
    const total = selection.completed.reduce((n, g) => n + g.todos.length, 0);
    const wrap = el('div', { class: 'completed' });

    const toggle = el('button', {
      class: 'completed__toggle',
      type: 'button',
      'aria-expanded': String(ui.completedOpen),
      onclick: () => app.toggleCompleted(),
    }, [
      icon('chevron', { size: 14, className: 'icon--chevron' }),
      `Completed (${total})`,
    ]);
    wrap.append(toggle);

    if (ui.completedOpen) {
      for (const group of selection.completed) {
        wrap.append(el('div', { class: 'completed__group-name', text: group.name }));
        const ul = el('ul', { class: 'todo-list', role: 'list' });
        for (const todo of group.todos) {
          ul.append(buildRow(app, todo, {
            nextId: null,
            reorderable: false,
            showListTag,
            completed: true,
          }));
        }
        wrap.append(ul);
      }
    }

    container.append(wrap);
  }
}

export { today };
