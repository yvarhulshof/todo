# Todo — working notes

A local-first todo web app. Static page, no backend, no accounts, no analytics.
Read [SPEC.md](SPEC.md) for the reasoning behind the design; this file is the
short version plus the rules that must not be broken by accident.

## Commands

```bash
npm run serve          # http://localhost:8080 — needs a real origin, see below
npm test               # unit tests, no dependencies
npm run test:browser   # end-to-end; needs: npm install --no-save playwright
```

Run both suites before pushing. The unit tests cover the logic layer; the
browser tests cover drag and drop, focus and reload persistence, which is where
the bugs actually turned up.

## Architecture

Vanilla ES modules, no build step, no runtime dependencies.

```
src/
  model.js      pure data operations — the layer under test
  query.js      view resolution: filter, group, sort
  quickadd.js   natural-language parsing
  dates.js      local calendar dates
  store.js      state + snapshot-based undo
  persist.js    file + localStorage + snapshots
  dnd.js        drag and drop
  main.js       controller, keyboard, wiring
  ui/           sidebar, list, dialogs, toasts
```

`model.js`, `query.js`, `quickadd.js` and `dates.js` are pure: no DOM, no
storage, no globals. Keep them that way — it is why they are testable.

## Invariants

These are deliberate decisions, not accidents. Changing any of them is a design
call to raise with the owner first, not a refactor.

**No network requests at runtime.** No fonts, CDNs, analytics, error reporting
or telemetry, ever. This is the property that makes the app defensible under a
corporate acceptable-use policy — it is the whole point, not a preference.

**No build step and no runtime dependencies.** The app must keep working years
from now with nothing installed. Dev-only tools are fine.

**Manual order is the stored truth.** Grouping and sorting are view layers.
Switching a view mode must never mutate `order`. Label groups have their own
`order` field, reordered by dragging a group header, independent of todo order.

**The drag handle hides only when a view is sorted by date, never by view
kind.** Smart views (Today/Upcoming/Overdue) default to date sort, but — as of
[#11](https://github.com/yvarhulshof/todo/issues/11) — switching *any* view,
smart or not, to Manual enables drag-to-reorder there too, overriding the date
order for display. Dragging must *not* rewrite due dates — that was
considered and rejected as too clever, and still holds: manual order and due
date are independent fields, and reordering never touches `dueDate`.

**Quick-add only parses date tokens at the end of the input.** `Review deck fri`
sets a date; `Book the friday room` stays intact. Parsing anywhere would be more
powerful and less predictable. `#label` is fine anywhere because `#` is
unambiguous.

**Smart views (Today/Upcoming/Overdue) are computed from due dates.** They
cannot be renamed, deleted, or dragged into. Dropping a todo on Today sets its
due date. Never add a *list* that duplicates one of these.

**Completing is not deleting**, and uncompleting restores the todo to its
original position.

**Deleting a label never deletes todos** — it clears the label off them.
**Deleting a list always asks** where its todos go. The last list cannot be
deleted.

**Every destructive action is undoable** — snapshot undo plus a toast with an
Undo button. `Ctrl+Z` works regardless of whether the toast is still up.

**The save indicator must never lie.** If data is only in localStorage it says
so, in amber. Silent data loss is the one unacceptable failure.

**Dates are local calendar strings (`YYYY-MM-DD`).** Never do arithmetic on
`Date` objects across day boundaries — that breaks over DST. Use `dates.js`.

**`migrate()` must keep reading old files.** Bump `schemaVersion` and migrate;
never make an existing user's file unreadable.

## Traps

Two bugs that already happened here, both easy to reintroduce:

**Renders are suppressed while a drag is in flight** (the `dragState.todoId` /
`dragState.labelId` guard in `main.js`) so the dragged node is not destroyed
mid-drag. Drop handlers must therefore clear the relevant `dragState` flag
*before* committing — `dragend` fires after the drop, too late.

**Do not rebuild input elements on render.** The quick-add field and the search
input are created once and updated in place. Rebuilding the topbar on every
render made typing in search lose focus after each keystroke. Note that
Playwright's `fill()` will not catch this — type character by character.

## Conventions

- The dev server exists because browsers give `file://` pages unreliable
  `localStorage` and block the File System Access API. The app needs a real
  origin.
- Paths are relative throughout, so the app works from a subdirectory
  (`/todo/` on GitHub Pages).
- Add a test with any behaviour change. UI, focus and drag behaviour go in
  `test/browser.mjs`; everything else in `test/logic.test.js`.
- `main` is the default branch and deploys to Pages on push.

## Deferred by choice

Recurring todos and subtasks. Both are real complexity jumps — recurrence
especially, once you reach "every 2nd Tuesday", completing an instance early,
and exceptions. The data model leaves room. Do not add either as a side effect
of another change.
