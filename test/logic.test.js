import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInitialData, addTodo, updateTodo, deleteTodo, setCompleted, moveTodo,
  addList, deleteList, addLabel, deleteLabel, moveLabel, orderBetween, normalizeOrder,
  needsNormalize, byOrder, migrate, ORDER_GAP,
} from '../src/model.js';
import { parseQuickAdd } from '../src/quickadd.js';
import { selectView, counts, canReorder, getOptions, viewKey } from '../src/query.js';
import { addDays, formatDue, daysFromToday, isValidISODate, nextWeekday } from '../src/dates.js';
import { saveStatusInfo } from '../src/ui/sidebar.js';

const NOW = '2026-08-21'; // a Friday

function seed() {
  const data = createInitialData();
  const inbox = data.lists[0].id;
  return { data, inbox };
}

// ------------------------------------------------------------------- dates

test('daysFromToday counts calendar days, not 24h periods', () => {
  assert.equal(daysFromToday('2026-08-21', NOW), 0);
  assert.equal(daysFromToday('2026-08-22', NOW), 1);
  assert.equal(daysFromToday('2026-08-20', NOW), -1);
  assert.equal(daysFromToday('2026-09-21', NOW), 31);
});

test('daysFromToday is unaffected by DST transitions', () => {
  // Europe/Amsterdam springs forward 2026-03-29. A naive ms/86400000 would
  // give 0.958 days here and round wrong.
  assert.equal(daysFromToday('2026-03-30', '2026-03-28'), 2);
  assert.equal(daysFromToday('2026-10-26', '2026-10-24'), 2);
});

test('formatDue uses relative words near today', () => {
  assert.equal(formatDue(NOW, NOW), 'Today');
  assert.equal(formatDue('2026-08-22', NOW), 'Tomorrow');
  assert.equal(formatDue('2026-08-20', NOW), 'Yesterday');
});

test('isValidISODate rejects impossible dates', () => {
  assert.ok(isValidISODate('2026-02-28'));
  assert.ok(!isValidISODate('2026-02-30'));
  assert.ok(!isValidISODate('2026-13-01'));
  assert.ok(!isValidISODate('21/08/2026'));
});

test('bare weekday means today when it is that day, next week for "next"', () => {
  assert.equal(nextWeekday(5, NOW, true), NOW);        // Friday, on a Friday
  assert.equal(nextWeekday(5, NOW, false), '2026-08-28');
});

// --------------------------------------------------------------- quick add

test('quick add parses a trailing date and a label', () => {
  const labels = [{ id: 'b1', name: 'urgent' }];
  const r = parseQuickAdd('Review deck fri #urgent', labels, NOW);
  assert.equal(r.title, 'Review deck');
  assert.equal(r.dueDate, NOW);
  assert.equal(r.labelId, 'b1');
  assert.equal(r.newLabelName, null);
});

test('quick add does NOT eat a date word mid-sentence', () => {
  const r = parseQuickAdd('Book the friday room for standup', [], NOW);
  assert.equal(r.title, 'Book the friday room for standup');
  assert.equal(r.dueDate, null);
});

test('quick add matches labels case-insensitively, flags unknown ones as new', () => {
  const labels = [{ id: 'b1', name: 'Urgent' }];
  assert.equal(parseQuickAdd('Ship it #URGENT', labels, NOW).labelId, 'b1');
  const fresh = parseQuickAdd('Ship it #backlog', labels, NOW);
  assert.equal(fresh.labelId, null);
  assert.equal(fresh.newLabelName, 'backlog');
});

test('quick add handles relative offsets and two-word phrases', () => {
  assert.equal(parseQuickAdd('Chase invoice 3d', [], NOW).dueDate, '2026-08-24');
  assert.equal(parseQuickAdd('Plan offsite 2w', [], NOW).dueDate, '2026-09-04');
  assert.equal(parseQuickAdd('Draft memo next week', [], NOW).dueDate, '2026-08-28');
  assert.equal(parseQuickAdd('Draft memo next monday', [], NOW).dueDate, '2026-08-24');
  assert.equal(parseQuickAdd('Send report in 5d', [], NOW).dueDate, '2026-08-26');
});

test('quick add rolls a bare day/month forward to the next occurrence', () => {
  assert.equal(parseQuickAdd('Buy gifts 24/12', [], NOW).dueDate, '2026-12-24');
  // January has already passed in August, so it means next year.
  assert.equal(parseQuickAdd('File taxes 15/01', [], NOW).dueDate, '2027-01-15');
  assert.equal(parseQuickAdd('Renew pass 24/12/2027', [], NOW).dueDate, '2027-12-24');
});

test('quick add ignores impossible dates rather than guessing', () => {
  const r = parseQuickAdd('Odd task 31/02', [], NOW);
  assert.equal(r.dueDate, null);
  assert.equal(r.title, 'Odd task 31/02');
});

test('quick add never consumes the entire title', () => {
  const r = parseQuickAdd('tomorrow', [], NOW);
  assert.equal(r.title, 'tomorrow');
  assert.equal(r.dueDate, null);
});

test('quick add reports chips so the user sees what was parsed', () => {
  const r = parseQuickAdd('Review deck tomorrow #new', [], NOW);
  assert.deepEqual(r.chips.map((c) => c.type).sort(), ['date', 'new-label']);
});

// ---------------------------------------------------------------- ordering

test('orderBetween always lands strictly between neighbours', () => {
  assert.equal(orderBetween(null, null), ORDER_GAP);
  assert.equal(orderBetween(1000, 2000), 1500);
  assert.ok(orderBetween(null, 1000) < 1000);
  assert.ok(orderBetween(1000, null) > 1000);
});

test('repeated inserts between the same pair trigger renumbering', () => {
  const todos = [];
  for (let i = 0; i < 3; i += 1) {
    todos.push({ id: `t${i}`, order: (i + 1) * ORDER_GAP, createdAt: `2026-01-0${i + 1}` });
  }
  // Drive the gap down until precision would fail.
  for (let i = 0; i < 60; i += 1) {
    todos[2].order = orderBetween(todos[0].order, todos[2].order);
  }
  assert.ok(needsNormalize(todos));
  normalizeOrder(todos);
  assert.ok(!needsNormalize(todos));
  const sorted = [...todos].sort(byOrder).map((t) => t.order);
  assert.deepEqual(sorted, [ORDER_GAP, ORDER_GAP * 2, ORDER_GAP * 3]);
});

test('moveTodo places an item before its target', () => {
  const { data, inbox } = seed();
  const a = addTodo(data, { title: 'A', listId: inbox });
  const b = addTodo(data, { title: 'B', listId: inbox });
  const c = addTodo(data, { title: 'C', listId: inbox });
  const ids = [a.id, b.id, c.id];

  moveTodo(data, c.id, { beforeId: a.id, orderedIds: ids });
  const order = data.todos.filter((t) => t.listId === inbox).sort(byOrder).map((t) => t.title);
  assert.deepEqual(order, ['C', 'A', 'B']);
});

test('moveTodo with beforeId null sends the item to the end', () => {
  const { data, inbox } = seed();
  const a = addTodo(data, { title: 'A', listId: inbox });
  const b = addTodo(data, { title: 'B', listId: inbox });
  moveTodo(data, a.id, { beforeId: null, orderedIds: [a.id, b.id] });
  const order = data.todos.sort(byOrder).map((t) => t.title);
  assert.deepEqual(order, ['B', 'A']);
});

test('moving between lists keeps a sane order in the destination', () => {
  const { data, inbox } = seed();
  const work = addList(data, 'Work');
  const a = addTodo(data, { title: 'A', listId: inbox });
  const w1 = addTodo(data, { title: 'W1', listId: work.id });
  moveTodo(data, a.id, { beforeId: w1.id, orderedIds: [w1.id], listId: work.id });
  assert.equal(a.listId, work.id);
  const inWork = data.todos.filter((t) => t.listId === work.id).sort(byOrder).map((t) => t.title);
  assert.deepEqual(inWork, ['A', 'W1']);
});

test('moveTodo adopts the labelId of the row it is dropped onto', () => {
  const { data, inbox } = seed();
  const urgent = addLabel(data, 'urgent');
  const a = addTodo(data, { title: 'A', listId: inbox });
  const u1 = addTodo(data, { title: 'U1', listId: inbox, labelId: urgent.id });
  moveTodo(data, a.id, { beforeId: u1.id, orderedIds: [u1.id], labelId: urgent.id });
  assert.equal(a.labelId, urgent.id);
});

test('moveTodo without labelId in the patch leaves the label untouched', () => {
  const { data, inbox } = seed();
  const urgent = addLabel(data, 'urgent');
  const a = addTodo(data, { title: 'A', listId: inbox, labelId: urgent.id });
  const b = addTodo(data, { title: 'B', listId: inbox });
  moveTodo(data, a.id, { beforeId: b.id, orderedIds: [b.id] });
  assert.equal(a.labelId, urgent.id);
});

test('moveTodo can adopt "no label" explicitly', () => {
  const { data, inbox } = seed();
  const urgent = addLabel(data, 'urgent');
  const a = addTodo(data, { title: 'A', listId: inbox, labelId: urgent.id });
  const b = addTodo(data, { title: 'B', listId: inbox });
  moveTodo(data, a.id, { beforeId: b.id, orderedIds: [b.id], labelId: null });
  assert.equal(a.labelId, null);
});

// ------------------------------------------------------------------- todos

test('a todo cannot be created or renamed to an empty title', () => {
  const { data, inbox } = seed();
  assert.equal(addTodo(data, { title: '   ', listId: inbox }), null);
  const t = addTodo(data, { title: 'Real', listId: inbox });
  updateTodo(data, t.id, { title: '  ' });
  assert.equal(t.title, 'Real');
});

test('completing is not deleting', () => {
  const { data, inbox } = seed();
  const t = addTodo(data, { title: 'A', listId: inbox });
  setCompleted(data, t.id, true);
  assert.equal(data.todos.length, 1);
  assert.ok(t.completedAt);
  setCompleted(data, t.id, false);
  assert.equal(t.completedAt, null);
});

test('uncompleting restores the todo to its original position', () => {
  const { data, inbox } = seed();
  const a = addTodo(data, { title: 'A', listId: inbox });
  const b = addTodo(data, { title: 'B', listId: inbox });
  const c = addTodo(data, { title: 'C', listId: inbox });
  const before = b.order;
  setCompleted(data, b.id, true);
  setCompleted(data, b.id, false);
  assert.equal(b.order, before);
  const view = selectView(data, { kind: 'list', id: inbox }, { now: NOW });
  assert.deepEqual(view.open.map((t) => t.title), ['A', 'B', 'C']);
  assert.ok(a && c);
});

// ------------------------------------------------------------- lists/labels

test('deleting a list reassigns its todos rather than orphaning them', () => {
  const { data, inbox } = seed();
  const work = addList(data, 'Work');
  addTodo(data, { title: 'W1', listId: work.id });
  deleteList(data, work.id, { reassignTo: inbox });
  assert.equal(data.lists.length, 1);
  assert.equal(data.todos.length, 1);
  assert.equal(data.todos[0].listId, inbox);
});

test('deleting a list with no reassignment removes its todos too', () => {
  const { data, inbox } = seed();
  const work = addList(data, 'Work');
  addTodo(data, { title: 'W1', listId: work.id });
  addTodo(data, { title: 'I1', listId: inbox });
  deleteList(data, work.id, { reassignTo: null });
  assert.deepEqual(data.todos.map((t) => t.title), ['I1']);
});

test('the last remaining list cannot be deleted', () => {
  const { data, inbox } = seed();
  assert.equal(deleteList(data, inbox, { reassignTo: null }), false);
  assert.equal(data.lists.length, 1);
});

test('deleting a label clears it off todos but never deletes them', () => {
  const { data, inbox } = seed();
  const label = addLabel(data, 'urgent');
  const t = addTodo(data, { title: 'A', listId: inbox, labelId: label.id });
  deleteLabel(data, label.id);
  assert.equal(data.todos.length, 1);
  assert.equal(t.labelId, null);
});

test('adding a duplicate label returns the existing one', () => {
  const { data } = seed();
  const a = addLabel(data, 'Urgent');
  const b = addLabel(data, 'urgent');
  assert.equal(a.id, b.id);
  assert.equal(data.labels.length, 1);
});

test('moveLabel places a label before its target, mirroring moveList', () => {
  const { data } = seed();
  const a = addLabel(data, 'A');
  addLabel(data, 'B');
  const c = addLabel(data, 'C');
  moveLabel(data, c.id, a.id);
  assert.deepEqual([...data.labels].sort(byOrder).map((l) => l.name), ['C', 'A', 'B']);
});

test('moveLabel with beforeId null sends the label to the end', () => {
  const { data } = seed();
  const a = addLabel(data, 'A');
  addLabel(data, 'B');
  moveLabel(data, a.id, null);
  assert.deepEqual([...data.labels].sort(byOrder).map((l) => l.name), ['B', 'A']);
});

test('label groups render in stored order, not creation order', () => {
  const { data, inbox } = seed();
  const zeta = addLabel(data, 'Zeta');
  const alpha = addLabel(data, 'Alpha');
  moveLabel(data, alpha.id, zeta.id);
  addTodo(data, { title: 'T1', listId: inbox, labelId: zeta.id });
  addTodo(data, { title: 'T2', listId: inbox, labelId: alpha.id });
  data.prefs.viewOptions[`list:${inbox}`] = { group: 'label' };

  const view = selectView(data, { kind: 'list', id: inbox }, { now: NOW });
  assert.deepEqual(view.groups.map((g) => g.name), ['Alpha', 'Zeta', 'No label']);
});

// -------------------------------------------------------------------- views

test('All shows todos from every list', () => {
  const { data, inbox } = seed();
  const work = addList(data, 'Work');
  addTodo(data, { title: 'I1', listId: inbox });
  addTodo(data, { title: 'W1', listId: work.id });
  const all = selectView(data, { kind: 'all' }, { now: NOW });
  assert.equal(all.openCount, 2);
  const listView = selectView(data, { kind: 'list', id: work.id }, { now: NOW });
  assert.deepEqual(listView.open.map((t) => t.title), ['W1']);
});

test('Today includes overdue, Overdue excludes today, Upcoming is strictly future', () => {
  const { data, inbox } = seed();
  addTodo(data, { title: 'Late', listId: inbox, dueDate: addDays(NOW, -2) });
  addTodo(data, { title: 'Now', listId: inbox, dueDate: NOW });
  addTodo(data, { title: 'Soon', listId: inbox, dueDate: addDays(NOW, 3) });
  addTodo(data, { title: 'Undated', listId: inbox });

  const todayView = selectView(data, { kind: 'smart', id: 'today' }, { now: NOW });
  assert.deepEqual(todayView.open.map((t) => t.title), ['Late', 'Now']);

  const overdue = selectView(data, { kind: 'smart', id: 'overdue' }, { now: NOW });
  assert.deepEqual(overdue.open.map((t) => t.title), ['Late']);

  const upcoming = selectView(data, { kind: 'smart', id: 'upcoming' }, { now: NOW });
  assert.deepEqual(upcoming.open.map((t) => t.title), ['Soon']);
});

test('smart views default to due-date sort, but Manual re-enables dragging there', () => {
  const view = { kind: 'smart', id: 'today' };
  const { data } = seed();
  const options = getOptions(data, view);
  assert.equal(options.sort, 'due');
  assert.equal(canReorder(view, options), false);
  assert.equal(canReorder(view, { ...options, sort: 'manual' }), true);
  assert.equal(canReorder({ kind: 'list', id: 'l1' }, { sort: 'manual' }), true);
  assert.equal(canReorder({ kind: 'list', id: 'l1' }, { sort: 'due' }), false);
});

test('manual reorder in a smart view overrides display order without touching due dates', () => {
  const { data, inbox } = seed();
  const a = addTodo(data, { title: 'A', listId: inbox, dueDate: addDays(NOW, -2) });
  const b = addTodo(data, { title: 'B', listId: inbox, dueDate: NOW });
  const view = { kind: 'smart', id: 'today' };
  data.prefs.viewOptions[viewKey(view)] = { sort: 'manual' };

  const before = selectView(data, view, { now: NOW });
  assert.deepEqual(before.open.map((t) => t.title), ['A', 'B']);

  const ids = before.open.map((t) => t.id);
  moveTodo(data, b.id, { beforeId: a.id, orderedIds: ids });

  const after = selectView(data, view, { now: NOW });
  assert.deepEqual(after.open.map((t) => t.title), ['B', 'A']);
  assert.equal(a.dueDate, addDays(NOW, -2));
  assert.equal(b.dueDate, NOW);
});

test('date sort puts undated todos last without losing their manual order', () => {
  const { data, inbox } = seed();
  addTodo(data, { title: 'NoDate1', listId: inbox });
  addTodo(data, { title: 'Later', listId: inbox, dueDate: addDays(NOW, 5) });
  addTodo(data, { title: 'NoDate2', listId: inbox });
  addTodo(data, { title: 'Sooner', listId: inbox, dueDate: addDays(NOW, 1) });
  data.prefs.viewOptions[`list:${inbox}`] = { sort: 'due' };
  const view = selectView(data, { kind: 'list', id: inbox }, { now: NOW });
  assert.deepEqual(view.open.map((t) => t.title), ['Sooner', 'Later', 'NoDate1', 'NoDate2']);
});

test('grouping by label keeps empty groups as drop targets and puts No label last', () => {
  const { data, inbox } = seed();
  const urgent = addLabel(data, 'urgent');
  const empty = addLabel(data, 'someday');
  addTodo(data, { title: 'A', listId: inbox, labelId: urgent.id });
  addTodo(data, { title: 'B', listId: inbox });
  data.prefs.viewOptions[`list:${inbox}`] = { group: 'label' };

  const view = selectView(data, { kind: 'list', id: inbox }, { now: NOW });
  assert.deepEqual(view.groups.map((g) => g.name), ['urgent', 'someday', 'No label']);
  assert.deepEqual(view.groups[0].todos.map((t) => t.title), ['A']);
  assert.deepEqual(view.groups[1].todos, []);
  assert.deepEqual(view.groups[2].todos.map((t) => t.title), ['B']);
  assert.ok(empty);
});

test('search matches title and note, and applies inside every view', () => {
  const { data, inbox } = seed();
  addTodo(data, { title: 'Quarterly deck', listId: inbox });
  addTodo(data, { title: 'Other', listId: inbox, note: 'mentions deck here' });
  addTodo(data, { title: 'Unrelated', listId: inbox });
  const view = selectView(data, { kind: 'all' }, { search: 'DECK', now: NOW });
  assert.deepEqual(view.open.map((t) => t.title).sort(), ['Other', 'Quarterly deck']);
});

test('completed todos are excluded from open and grouped by completion day', () => {
  const { data, inbox } = seed();
  const a = addTodo(data, { title: 'A', listId: inbox });
  addTodo(data, { title: 'B', listId: inbox });
  setCompleted(data, a.id, true);
  const view = selectView(data, { kind: 'list', id: inbox }, { now: NOW });
  assert.deepEqual(view.open.map((t) => t.title), ['B']);
  assert.equal(view.completed.length, 1);
  assert.deepEqual(view.completed[0].todos.map((t) => t.title), ['A']);
});

test('sidebar counts ignore completed todos and count overdue into today', () => {
  const { data, inbox } = seed();
  const done = addTodo(data, { title: 'Done', listId: inbox, dueDate: NOW });
  setCompleted(data, done.id, true);
  addTodo(data, { title: 'Late', listId: inbox, dueDate: addDays(NOW, -1) });
  addTodo(data, { title: 'Soon', listId: inbox, dueDate: addDays(NOW, 2) });

  const c = counts(data, NOW);
  assert.equal(c.all, 2);
  assert.equal(c.smart.overdue, 1);
  assert.equal(c.smart.today, 1);
  assert.equal(c.smart.upcoming, 1);
});

// --------------------------------------------------------------- migration

test('migrate repairs dangling list and label references', () => {
  const data = migrate({
    schemaVersion: 1,
    lists: [{ id: 'l1', name: 'Inbox', order: 1024 }],
    labels: [{ id: 'b1', name: 'urgent', color: 'red' }],
    todos: [
      { id: 't1', title: 'Orphan', listId: 'GONE', labelId: 'ALSO_GONE', order: 1 },
      { id: 't2', title: 'Fine', listId: 'l1', labelId: 'b1', order: 2 },
    ],
  });
  assert.equal(data.todos[0].listId, 'l1');
  assert.equal(data.todos[0].labelId, null);
  assert.equal(data.todos[1].labelId, 'b1');
});

test('migrate drops junk rows instead of throwing', () => {
  const data = migrate({
    lists: [{ id: 'l1', name: 'Inbox' }],
    todos: [null, { id: 't1' }, { id: 't2', title: 'Good', listId: 'l1' }],
  });
  assert.deepEqual(data.todos.map((t) => t.title), ['Good']);
  assert.ok(Number.isFinite(data.lists[0].order));
});

test('migrate rejects documents that are not todo files at all', () => {
  assert.equal(migrate(null), null);
  assert.equal(migrate({ hello: 'world' }), null);
  assert.equal(migrate('a string'), null);
});

test('migrate always leaves at least one list', () => {
  const data = migrate({ lists: [], todos: [] });
  assert.equal(data.lists.length, 1);
});

test('migrate backfills order onto labels from an old file, keeping their sequence', () => {
  const data = migrate({
    lists: [{ id: 'l1', name: 'Inbox', order: 1024 }],
    labels: [{ id: 'b1', name: 'urgent', color: 'red' }, { id: 'b2', name: 'later', color: 'blue' }],
    todos: [],
  });
  assert.ok(Number.isFinite(data.labels[0].order));
  assert.ok(Number.isFinite(data.labels[1].order));
  assert.ok(data.labels[0].order < data.labels[1].order);
});

test('deleteTodo removes exactly one todo', () => {
  const { data, inbox } = seed();
  const a = addTodo(data, { title: 'A', listId: inbox });
  addTodo(data, { title: 'B', listId: inbox });
  assert.equal(deleteTodo(data, a.id), true);
  assert.equal(deleteTodo(data, 'nope'), false);
  assert.deepEqual(data.todos.map((t) => t.title), ['B']);
});

// --- save status indicator --------------------------------------------
// Closing a tab drops File System Access permission in most browsers, even
// though the handle itself is still remembered in IndexedDB. That state
// (persist.js: `pendingHandle`) must read differently from "never attached a
// file at all" so the one-click reconnect is discoverable.

test('save status: never attached a file reads as cache-only, no reconnect', () => {
  const info = saveStatusInfo({ status: 'cache-only', fileName: null, pendingHandle: null });
  assert.equal(info.text, 'This browser only');
  assert.equal(info.pending, false);
  assert.match(info.title, /attach a file/);
});

test('save status: dropped permission offers a one-click reconnect', () => {
  const info = saveStatusInfo({
    status: 'cache-only',
    fileName: 'todo-data.json',
    pendingHandle: { name: 'todo-data.json' },
  });
  assert.equal(info.text, 'Reconnect to todo-data.json');
  assert.equal(info.pending, true);
  assert.match(info.title, /reconnect/i);
});

test('save status: connected file never shows a reconnect prompt', () => {
  const info = saveStatusInfo({ status: 'saved', fileName: 'todo-data.json', pendingHandle: null });
  assert.equal(info.text, 'Saved to todo-data.json');
  assert.equal(info.pending, false);
});
