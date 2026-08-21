# Todo

A local-first todo app for work. No backend, no accounts, no analytics, no
third-party requests — the page is static and your data never leaves your
machine.

That last point is the design constraint everything else follows from: a todo
list at work names clients, colleagues and unreleased projects, so it has no
business sitting on infrastructure your employer has not vetted.

---

## Running it

```bash
npm run serve      # http://localhost:8080
```

No build step and no runtime dependencies. The dev server exists only because
browsers give `file://` pages unreliable `localStorage` and block the File
System Access API — the app needs a real origin.

## Deploying to GitHub Pages

Push to the default branch. The included workflow publishes the repository root
as-is; there is nothing to compile.

One-time setup: **Settings → Pages → Source → GitHub Actions**.

Only the code is served from GitHub. Your todos are never uploaded.

---

## Keeping your data safe

Open the storage menu at the bottom of the sidebar. It always tells you the
truth about where your todos live:

| Indicator | Meaning |
|---|---|
| **This browser only** (amber) | Data is in `localStorage` alone. Clearing site data would lose it. |
| **Saved to *file*** (green) | Every change is written straight through to a real file on disk. |

**Attach a file inside your OneDrive folder.** You then get sync across
machines, version history and backup from storage your employer already
manages, and clearing your browser data costs you nothing. The file handle is
remembered, so the app reconnects on later visits without asking again.

Underneath that, in order of durability:

1. **The file** — the source of truth when attached.
2. **`localStorage`** — a cache, so the app opens instantly and works before a
   file is picked, or in browsers without the File System Access API.
3. **`navigator.storage.persist()`** — asks the browser not to evict the cache
   under disk pressure. Best effort; it does not survive a deliberate clear.
4. **Snapshots** — the last 20 states, kept locally for recovery.
5. **Export / import JSON** — the escape hatch that works everywhere.

File-backed saving needs Chrome or Edge. Firefox and Safari fall back to the
cache plus manual export, and the app says so rather than pretending.

> If your organisation forces *delete browsing data on exit* by policy, or you
> are on non-persistent VDI, the cache is wiped at every logoff. Attaching a
> file is then not optional.

---

## Quick add

One field does the work of a form:

```
Review deck fri #urgent
```

→ title `Review deck`, due next Friday, labelled `urgent`. Parsed tokens appear
as chips before you press Enter, so it never guesses silently.

| Syntax | Example |
|---|---|
| Relative | `today`, `tomorrow`, `tom` |
| Weekday | `fri`, `monday` — today counts if it is that day |
| Next | `next week`, `next monday` |
| Offset | `3d`, `2w`, `in 5d` |
| Calendar | `24/12`, `24/12/2027`, `2027-12-24` |
| Label | `#urgent` — creates the label if it is new |

Date tokens are only recognised **at the end** of the input. `Book the friday
room` stays intact; `Review deck friday` sets a date. Predictable beats clever.

## Keyboard

| Key | Action |
|---|---|
| `n` | New todo |
| `/` | Search |
| `↑` `↓` | Move selection |
| `Alt`+`↑` `↓` | Reorder the selected todo |
| `Space` | Complete / reopen |
| `e` or `Enter` | Edit inline |
| `Backspace` | Delete (with undo) |
| `Ctrl`+`Z` | Undo — works on everything |
| `Ctrl`+`Shift`+`Z` | Redo |
| `Esc` | Clear selection, or cancel an edit |

Every destructive action shows an undo toast as well. Nothing is lost to one
misclick.

---

## How it is organised

- **Lists** are folders: a todo lives in exactly one. **All** is a view over
  every list, not a list itself.
- **Labels** are one per todo, colour-coded, and cut across lists.
- **Today / Upcoming / Overdue** are computed from due dates. They cannot be
  renamed or deleted, and you cannot drag *into* them — dropping a todo on
  **Today** sets its due date to today, which is what you meant.
- **Manual order is the stored truth.** Grouping and sorting are view modes
  layered on top; switching them never rearranges your list.
- When grouped by label, dragging a todo **across** a group boundary reassigns
  its label. That is the relabel gesture — no menu needed.
- When sorted by date, the drag handle disappears rather than failing silently.

Full reasoning, including the conflicts in the original spec and how they were
resolved, is in [SPEC.md](SPEC.md).

## Not in v1

Recurring todos and subtasks, both deliberately. Each is a real complexity jump
— recurrence especially, once you hit "every 2nd Tuesday", completing one early,
and exceptions. The data model leaves room for both.

---

## Tests

```bash
npm test           # 39 unit tests, no dependencies
npm run test:browser   # 49 end-to-end checks; needs: npm i --no-save playwright
```

The unit tests cover ordering (including gap-index exhaustion), deletion
semantics, smart-view boundaries, date parsing and migration of damaged files.
The browser tests cover drag and drop, focus, rendering and reload persistence —
they are what caught the render-suppressed-during-drag bug.

## Layout

```
index.html          shell
assets/styles.css   design tokens, light + dark
src/
  model.js          pure data operations
  query.js          view resolution: filter, group, sort
  quickadd.js       natural-language parsing
  dates.js          local calendar dates, no timezone drift
  store.js          state, snapshot-based undo
  persist.js        file + cache + snapshots
  dnd.js            drag and drop
  main.js           controller, keyboard, wiring
  ui/               sidebar, list, dialogs, toasts
sw.js               offline cache
```
