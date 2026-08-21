# Todo — design spec

A local-first todo web app. No backend, no accounts, no analytics, no third-party
requests. All data stays on the user's machine.

## 1. Locked decisions

| Question | Decision |
|---|---|
| Labels per todo | Exactly one (or none) |
| Todo in multiple lists | No — one list each; "All" is a virtual view |
| Due dates | Yes, optional, plus date-driven scheduled views |
| Hosting | Static site, GitHub Pages |

## 2. Data model

Single JSON document. `schemaVersion` gates all future migrations.

```jsonc
{
  "schemaVersion": 1,
  "lists":  [{ "id": "l_a1", "name": "Work", "order": 1024, "createdAt": "..." }],
  "labels": [{ "id": "b_a1", "name": "urgent", "color": "#e5484d" }],
  "todos": [{
    "id": "t_a1",
    "title": "Review Q3 deck",
    "note": "",                      // optional one-liner
    "listId": "l_a1",                // exactly one, never null
    "labelId": "b_a1",               // or null
    "dueDate": "2026-08-24",         // date only, no time. or null
    "completedAt": "2026-08-21T09:12:00.000Z",  // null when open
    "order": 2048,
    "createdAt": "...", "updatedAt": "..."
  }],
  "prefs": { "theme": "auto", "lastView": "list:l_a1" }
}
```

**Ordering** uses gap indexing (new items spaced 1024 apart). A drag rewrites the
`order` of the moved item only, not the whole list. Ties break by `createdAt`.

**Deletion is real deletion.** Completing is not deleting — they are separate
actions with separate undo.

## 3. Resolved tensions

### 3.1 Manual order vs. grouping vs. sorting

Drag-to-reorder and sort-by-due-date are two different orderings competing for the
same list. The rule:

- **Manual order is the stored truth.** Grouping and sorting are *view modes* layered
  over it; switching view modes never mutates `order`.
- **Grouped by label:** dragging *within* a group reorders. Dragging *across* groups
  reassigns `labelId` — that's how you relabel, no menu needed.
- **Sorted by due date:** drag-to-reorder is disabled, and the drag handle is hidden
  rather than left there to fail silently. Cross-list drags still work.
- Default view is manual order, ungrouped.

### 3.2 The two "Today"s

The spec has user-created lists named "Today" *and* date-driven scheduled views.
Two things called Today that disagree is the exact failure mode of MS To Do.

- **Smart views** (Today, Upcoming, Overdue) are computed from `dueDate`, live in
  their own sidebar section above user lists, and cannot be renamed or deleted.
- **User lists** are manual buckets. Creating one named "Today" is allowed but
  warned against once.
- Todos cannot be dragged *into* a smart view — that would be ambiguous. Dropping a
  todo on "Today" instead sets `dueDate` to today, which is what the user meant.

### 3.3 What "All" means

`All` is a read-only view over every todo regardless of list. You *can* drag within
it (it writes global `order`) and you *can* drag out of it onto a sidebar list. You
cannot delete it.

## 4. Persistence

Layered, per the durability discussion:

1. **File-backed (primary).** File System Access API writes a `.json` through to a
   real file on disk — intended target is a folder inside OneDrive, so the user gets
   sync, versioning and backup from company-sanctioned storage. The handle is kept in
   IndexedDB so it silently reconnects on later visits.
2. **localStorage (cache).** Mirrors current state so the app opens instantly and
   works before/without a file being picked.
3. **`navigator.storage.persist()`** on first run, to exempt the cache from
   quota-pressure eviction.
4. **Snapshot ring.** Last 20 states retained, for cross-session undo of bulk damage.
5. **Manual export / import** JSON. The escape hatch that always works.

Write-through is debounced ~500ms. A visible save indicator shows synced / saving /
**not file-backed** so the user is never wrong about whether their data is safe.

## 5. Features

### v1
- Add, edit inline, complete, uncomplete, delete a todo
- **Quick add with parsing** — `Review deck fri #urgent` sets title, due date and
  label in one keystroke-free pass. Accepts `today`, `tomorrow`, `mon`–`sun`, `3d`,
  `24/12`, and `#label`. Parsed tokens are shown as chips before commit so it's never
  a surprise.
- Optional one-line note per todo
- Labels: create, rename, recolour, delete (delete clears the label off its todos,
  never deletes todos)
- Lists: create, rename, reorder, delete (delete asks where the todos go)
- Due dates, with overdue in red and today in amber
- Smart views: Today, Upcoming, Overdue
- Group by label / sort by due date / manual
- Drag to reorder, drag between lists
- **Undo toast** on every destructive action, ~8s, `Ctrl+Z` also works
- Completed tab: grouped by completion day, greyed, not struck through, click to
  restore
- Search across title and note
- Keyboard: `n` new, `/` search, `↑↓` move selection, `space` complete, `e` edit,
  `⌫` delete, `Ctrl+Z` undo
- Dark mode via `prefers-color-scheme`, with a manual override
- Keyboard alternative to dragging (`Alt+↑↓`) — dragging is slow and inaccessible
- Empty states that say what to do next

### Deliberately deferred
- **Recurring todos.** The thing MS To Do does worst, and a real complexity jump
  (exceptions, "every 2nd Tuesday", what happens when you complete one early). The
  data model leaves room; v2.
- **Subtasks.** Also v2. One level only when it lands.
- Priorities — the label covers this.
- Attachments, sharing, collaboration, reminders/notifications.

## 6. UI

Sleek and professional means restrained, not decorated.

- Two-pane: sidebar (smart views, then user lists, then labels) + main list
- One accent colour; label colours are the only other saturated pixels on screen
- System font stack, generous line height, ~720px max content width
- Motion under 150ms, and honour `prefers-reduced-motion`
- No modal dialogs except destructive confirms; editing is inline
- Focus rings on everything, full keyboard reachability, semantic checkboxes

## 7. Non-goals

No network requests of any kind at runtime — this is a hard constraint, not a
preference, and is what makes the app defensible under a corporate acceptable-use
policy. No fonts, analytics, error reporting, or CDN assets. The built site must be
verifiably static.
