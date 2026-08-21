// Pure data operations. No DOM, no persistence, no globals — every function
// takes the data object and mutates it in place. This is the layer under test.

import { today } from './dates.js';

export const SCHEMA_VERSION = 1;
export const ORDER_GAP = 1024;

// Curated palette. Freeform colour pickers are how "professional" becomes a
// ransom note; these eight hold contrast in both light and dark themes.
export const LABEL_COLORS = [
  { id: 'red',    hex: '#e5484d' },
  { id: 'orange', hex: '#f76b15' },
  { id: 'amber',  hex: '#ffb224' },
  { id: 'green',  hex: '#30a46c' },
  { id: 'teal',   hex: '#12a594' },
  { id: 'blue',   hex: '#0091ff' },
  { id: 'violet', hex: '#6e56cf' },
  { id: 'pink',   hex: '#d6409f' },
];

let counter = 0;
export function uid(prefix) {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

const now = () => new Date().toISOString();

export function createInitialData() {
  const inbox = { id: uid('l'), name: 'Inbox', order: ORDER_GAP, createdAt: now() };
  return {
    schemaVersion: SCHEMA_VERSION,
    lists: [inbox],
    labels: [],
    todos: [],
    prefs: { theme: 'auto', lastView: `list:${inbox.id}`, viewOptions: {} },
  };
}

// ---------------------------------------------------------------- ordering

/**
 * An order value that sorts strictly between two neighbours.
 * `null` neighbours mean "at the start" / "at the end".
 */
export function orderBetween(before, after) {
  if (before == null && after == null) return ORDER_GAP;
  if (before == null) return after - ORDER_GAP;
  if (after == null) return before + ORDER_GAP;
  return (before + after) / 2;
}

/**
 * Repeated insertions between the same pair eventually exhaust float
 * precision. When neighbours get too close, renumber the whole set.
 */
export function normalizeOrder(todos) {
  const sorted = [...todos].sort(byOrder);
  sorted.forEach((t, i) => {
    t.order = (i + 1) * ORDER_GAP;
  });
}

export function byOrder(a, b) {
  if (a.order !== b.order) return a.order - b.order;
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

/** True when orders have degenerated and need renumbering. */
export function needsNormalize(todos) {
  const sorted = [...todos].sort(byOrder);
  for (let i = 1; i < sorted.length; i += 1) {
    // A gap of exactly 0 is the worst case, not an excluded one: enough
    // halvings and the two orders round to the same double.
    const gap = sorted[i].order - sorted[i - 1].order;
    if (gap < 0.0001) return true;
  }
  return false;
}

// ------------------------------------------------------------------- todos

export function addTodo(data, { title, listId, labelId = null, dueDate = null, note = '' }) {
  const clean = title.trim();
  if (!clean) return null;
  const list = data.lists.find((l) => l.id === listId) || data.lists[0];
  const siblings = data.todos.filter((t) => t.listId === list.id);
  const max = siblings.reduce((m, t) => Math.max(m, t.order), 0);
  const todo = {
    id: uid('t'),
    title: clean,
    note,
    listId: list.id,
    labelId,
    dueDate,
    completedAt: null,
    order: max + ORDER_GAP,
    createdAt: now(),
    updatedAt: now(),
  };
  data.todos.push(todo);
  return todo;
}

export function updateTodo(data, id, patch) {
  const todo = data.todos.find((t) => t.id === id);
  if (!todo) return null;
  if (typeof patch.title === 'string') {
    const clean = patch.title.trim();
    if (!clean) return todo; // never let a todo become nameless
    todo.title = clean;
  }
  for (const key of ['note', 'labelId', 'dueDate', 'listId']) {
    if (key in patch) todo[key] = patch[key];
  }
  todo.updatedAt = now();
  return todo;
}

export function deleteTodo(data, id) {
  const i = data.todos.findIndex((t) => t.id === id);
  if (i === -1) return false;
  data.todos.splice(i, 1);
  return true;
}

export function setCompleted(data, id, completed) {
  const todo = data.todos.find((t) => t.id === id);
  if (!todo) return null;
  todo.completedAt = completed ? now() : null;
  todo.updatedAt = now();
  return todo;
}

/**
 * Move `id` so it sits immediately before `beforeId` within `orderedIds`
 * (the ids as currently displayed). Pass `beforeId: null` to move to the end.
 * `listId` moves it between lists at the same time.
 */
export function moveTodo(data, id, { beforeId = null, orderedIds = [], listId = null }) {
  const todo = data.todos.find((t) => t.id === id);
  if (!todo) return null;
  if (listId && listId !== todo.listId) todo.listId = listId;

  const others = orderedIds
    .filter((x) => x !== id)
    .map((x) => data.todos.find((t) => t.id === x))
    .filter(Boolean);

  const idx = beforeId ? others.findIndex((t) => t.id === beforeId) : others.length;
  const prev = idx > 0 ? others[idx - 1].order : null;
  const next = idx >= 0 && idx < others.length ? others[idx].order : null;

  todo.order = orderBetween(prev, next);
  todo.updatedAt = now();

  const scope = data.todos.filter((t) => t.listId === todo.listId);
  if (needsNormalize(scope)) normalizeOrder(scope);
  return todo;
}

// ------------------------------------------------------------------- lists

export function addList(data, name) {
  const clean = name.trim();
  if (!clean) return null;
  const max = data.lists.reduce((m, l) => Math.max(m, l.order), 0);
  const list = { id: uid('l'), name: clean, order: max + ORDER_GAP, createdAt: now() };
  data.lists.push(list);
  return list;
}

export function renameList(data, id, name) {
  const list = data.lists.find((l) => l.id === id);
  const clean = name.trim();
  if (!list || !clean) return null;
  list.name = clean;
  return list;
}

/**
 * Delete a list. Its todos move to `reassignTo`, or are deleted when
 * `reassignTo` is null. Never leaves orphaned todos behind.
 */
export function deleteList(data, id, { reassignTo = null } = {}) {
  if (data.lists.length <= 1) return false; // always keep one list
  const i = data.lists.findIndex((l) => l.id === id);
  if (i === -1) return false;
  const orphans = data.todos.filter((t) => t.listId === id);
  if (reassignTo) {
    const target = data.lists.find((l) => l.id === reassignTo);
    if (!target) return false;
    const max = data.todos
      .filter((t) => t.listId === reassignTo)
      .reduce((m, t) => Math.max(m, t.order), 0);
    orphans.forEach((t, n) => {
      t.listId = reassignTo;
      t.order = max + (n + 1) * ORDER_GAP;
    });
  } else {
    data.todos = data.todos.filter((t) => t.listId !== id);
  }
  data.lists.splice(i, 1);
  return true;
}

export function moveList(data, id, beforeId) {
  const list = data.lists.find((l) => l.id === id);
  if (!list) return null;
  const others = [...data.lists].sort(byOrder).filter((l) => l.id !== id);
  const idx = beforeId ? others.findIndex((l) => l.id === beforeId) : others.length;
  const prev = idx > 0 ? others[idx - 1].order : null;
  const next = idx >= 0 && idx < others.length ? others[idx].order : null;
  list.order = orderBetween(prev, next);
  if (needsNormalize(data.lists)) normalizeOrder(data.lists);
  return list;
}

// ------------------------------------------------------------------ labels

export function addLabel(data, name, colorId) {
  const clean = name.trim();
  if (!clean) return null;
  const existing = data.labels.find((l) => l.name.toLowerCase() === clean.toLowerCase());
  if (existing) return existing;
  const color = colorId || LABEL_COLORS[data.labels.length % LABEL_COLORS.length].id;
  const label = { id: uid('b'), name: clean, color };
  data.labels.push(label);
  return label;
}

export function updateLabel(data, id, patch) {
  const label = data.labels.find((l) => l.id === id);
  if (!label) return null;
  if (patch.name && patch.name.trim()) label.name = patch.name.trim();
  if (patch.color) label.color = patch.color;
  return label;
}

/** Deleting a label clears it off its todos. It never deletes todos. */
export function deleteLabel(data, id) {
  const i = data.labels.findIndex((l) => l.id === id);
  if (i === -1) return false;
  data.todos.forEach((t) => {
    if (t.labelId === id) t.labelId = null;
  });
  data.labels.splice(i, 1);
  return true;
}

export function labelHex(data, labelId) {
  const label = data.labels.find((l) => l.id === labelId);
  if (!label) return null;
  return (LABEL_COLORS.find((c) => c.id === label.color) || LABEL_COLORS[0]).hex;
}

// --------------------------------------------------------------- migration

/** Validate and upgrade a loaded document. Returns null if unusable. */
export function migrate(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!Array.isArray(raw.lists) || !Array.isArray(raw.todos)) return null;

  const data = {
    schemaVersion: SCHEMA_VERSION,
    lists: raw.lists.filter((l) => l && l.id && l.name),
    labels: Array.isArray(raw.labels) ? raw.labels.filter((l) => l && l.id && l.name) : [],
    todos: [],
    prefs: { theme: 'auto', lastView: null, viewOptions: {}, ...(raw.prefs || {}) },
  };
  if (!data.lists.length) data.lists = [createInitialData().lists[0]];

  const listIds = new Set(data.lists.map((l) => l.id));
  const labelIds = new Set(data.labels.map((l) => l.id));
  const fallback = data.lists[0].id;

  data.todos = raw.todos
    .filter((t) => t && t.id && typeof t.title === 'string')
    .map((t) => ({
      id: t.id,
      title: t.title,
      note: typeof t.note === 'string' ? t.note : '',
      listId: listIds.has(t.listId) ? t.listId : fallback,
      labelId: labelIds.has(t.labelId) ? t.labelId : null,
      dueDate: typeof t.dueDate === 'string' ? t.dueDate : null,
      completedAt: typeof t.completedAt === 'string' ? t.completedAt : null,
      order: Number.isFinite(t.order) ? t.order : ORDER_GAP,
      createdAt: t.createdAt || now(),
      updatedAt: t.updatedAt || t.createdAt || now(),
    }));

  data.lists.forEach((l, i) => {
    if (!Number.isFinite(l.order)) l.order = (i + 1) * ORDER_GAP;
  });
  return data;
}

export { today };
