// View resolution: which todos are visible, in what order, in what groups.
// Pure functions over the data document — no DOM.

import { byOrder } from './model.js';
import { today, daysFromToday, formatCompletedGroup } from './dates.js';

export const SMART_VIEWS = [
  { id: 'today', name: 'Today', icon: 'sun' },
  { id: 'upcoming', name: 'Upcoming', icon: 'calendar' },
  { id: 'overdue', name: 'Overdue', icon: 'alert' },
];

export function viewKey(view) {
  return view.kind === 'all' ? 'all' : `${view.kind}:${view.id}`;
}

export function parseViewKey(key, data) {
  if (!key) return null;
  if (key === 'all') return { kind: 'all' };
  const [kind, id] = key.split(':');
  if (kind === 'list' && data.lists.some((l) => l.id === id)) return { kind: 'list', id };
  if (kind === 'label' && data.labels.some((l) => l.id === id)) return { kind: 'label', id };
  if (kind === 'smart' && SMART_VIEWS.some((v) => v.id === id)) return { kind: 'smart', id };
  return null;
}

export function viewTitle(view, data) {
  switch (view.kind) {
    case 'all':
      return 'All';
    case 'list':
      return data.lists.find((l) => l.id === view.id)?.name ?? 'List';
    case 'label':
      return data.labels.find((l) => l.id === view.id)?.name ?? 'Label';
    case 'smart':
      return SMART_VIEWS.find((v) => v.id === view.id)?.name ?? 'View';
    default:
      return '';
  }
}

/** Smart views are computed from dates, so manual ordering is meaningless. */
export function isSmart(view) {
  return view.kind === 'smart';
}

export function defaultOptions(view) {
  return isSmart(view) ? { group: 'none', sort: 'due' } : { group: 'none', sort: 'manual' };
}

export function getOptions(data, view) {
  return { ...defaultOptions(view), ...(data.prefs.viewOptions?.[viewKey(view)] || {}) };
}

/**
 * Dragging to reorder is only meaningful when manual order is what's shown —
 * including in a smart view once it has been switched to Manual sort. That
 * never rewrites `dueDate`: order and due date are independent fields.
 */
export function canReorder(view, options) {
  return options.sort === 'manual';
}

/** The list a newly added todo lands in for this view. */
export function targetListId(view, data) {
  if (view.kind === 'list') return view.id;
  return data.lists[0]?.id ?? null;
}

/** The due date a newly added todo gets for this view, before parsing. */
export function targetDueDate(view, now = today()) {
  if (view.kind === 'smart' && (view.id === 'today' || view.id === 'overdue')) return now;
  return null;
}

export function targetLabelId(view) {
  return view.kind === 'label' ? view.id : null;
}

function matchesView(todo, view, now) {
  switch (view.kind) {
    case 'all':
      return true;
    case 'list':
      return todo.listId === view.id;
    case 'label':
      return todo.labelId === view.id;
    case 'smart': {
      if (!todo.dueDate) return false;
      const delta = daysFromToday(todo.dueDate, now);
      if (view.id === 'today') return delta <= 0;
      if (view.id === 'overdue') return delta < 0;
      if (view.id === 'upcoming') return delta > 0;
      return false;
    }
    default:
      return false;
  }
}

function matchesSearch(todo, needle) {
  if (!needle) return true;
  const q = needle.toLowerCase();
  return todo.title.toLowerCase().includes(q) || todo.note.toLowerCase().includes(q);
}

function sortTodos(todos, sort) {
  const out = [...todos];
  if (sort === 'due') {
    out.sort((a, b) => {
      if (a.dueDate && b.dueDate) {
        if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
      } else if (a.dueDate) return -1;
      else if (b.dueDate) return 1;
      return byOrder(a, b);
    });
  } else {
    out.sort(byOrder);
  }
  return out;
}

/**
 * @returns {{open: Array, groups: Array<{id, name, color, todos}>,
 *            completed: Array<{name, todos}>, openCount: number}}
 */
export function selectView(data, view, { search = '', now = today() } = {}) {
  const options = getOptions(data, view);
  const visible = data.todos.filter((t) => matchesView(t, view, now) && matchesSearch(t, search));

  const open = sortTodos(visible.filter((t) => !t.completedAt), options.sort);
  const done = visible
    .filter((t) => t.completedAt)
    .sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1));

  let groups;
  if (options.group === 'label') {
    const byLabel = new Map();
    for (const label of data.labels) byLabel.set(label.id, []);
    const unlabelled = [];
    for (const todo of open) {
      if (todo.labelId && byLabel.has(todo.labelId)) byLabel.get(todo.labelId).push(todo);
      else unlabelled.push(todo);
    }
    groups = [...data.labels]
      .sort(byOrder)
      .map((label) => ({
        id: label.id,
        name: label.name,
        color: label.color,
        todos: byLabel.get(label.id) ?? [],
      }))
      // Keep empty groups so they remain drop targets for relabelling.
      .concat([{ id: null, name: 'No label', color: null, todos: unlabelled }]);
  } else {
    groups = [{ id: null, name: null, color: null, todos: open }];
  }

  // Completed items group by the day they were completed.
  const completedGroups = [];
  for (const todo of done) {
    const name = formatCompletedGroup(todo.completedAt, now);
    const last = completedGroups[completedGroups.length - 1];
    if (last && last.name === name) last.todos.push(todo);
    else completedGroups.push({ name, todos: [todo] });
  }

  return { open, groups, completed: completedGroups, openCount: open.length, options };
}

/** Badge counts for the sidebar. Open todos only. */
export function counts(data, now = today()) {
  const out = { all: 0, lists: {}, labels: {}, smart: { today: 0, upcoming: 0, overdue: 0 } };
  for (const todo of data.todos) {
    if (todo.completedAt) continue;
    out.all += 1;
    out.lists[todo.listId] = (out.lists[todo.listId] || 0) + 1;
    if (todo.labelId) out.labels[todo.labelId] = (out.labels[todo.labelId] || 0) + 1;
    if (todo.dueDate) {
      const delta = daysFromToday(todo.dueDate, now);
      if (delta < 0) {
        out.smart.overdue += 1;
        out.smart.today += 1;
      } else if (delta === 0) out.smart.today += 1;
      else out.smart.upcoming += 1;
    }
  }
  return out;
}
