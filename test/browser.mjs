// End-to-end checks against a real Chromium.
//
// Requires Playwright:  npm install --no-save playwright
// Run with:             npm run test:browser
//
// These cover what the unit tests cannot: drag and drop, focus behaviour,
// rendering, and persistence across a reload. The suppress-render-during-drag
// bug was found here, not in the unit tests.

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 8099;
const URL = `http://localhost:${PORT}/`;

const server = spawn(process.execPath, ['scripts/serve.js'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});
process.on('exit', () => server.kill());

async function waitForServer() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(URL);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('dev server did not start');
}
await waitForServer();

let failures = 0;
function check(name, cond, extra = '') {
  if (!cond) failures += 1;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : '  <- ' + extra}`);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.quickadd input');

const titles = () => page.locator('.todo-list .todo__title').allTextContents();

console.log('\n# core');
{
const input = page.locator('.quickadd input');
// --- boot
await page.waitForSelector('.quickadd input');
check('app boots', await page.locator('.sidebar').isVisible());
check('sidebar has All + smart views', (await page.locator('.nav-item').count()) >= 5);

// --- quick add with parsing
await input.fill('Review deck fri #urgent');
await page.waitForTimeout(120);
const chips = await page.locator('.chip').allTextContents();
check('chips preview parse', chips.length === 2, JSON.stringify(chips));
await input.press('Enter');
await page.waitForTimeout(150);

check('todo added', (await page.locator('.todo').count()) === 1);
check('title stripped of tokens',
  (await page.locator('.todo__title').first().textContent()) === 'Review deck',
  await page.locator('.todo__title').first().textContent());
check('label chip rendered', await page.locator('.label-chip').first().isVisible());
check('due chip rendered', await page.locator('.due').first().isVisible());
check('label auto-created in sidebar',
  (await page.locator('.nav-item__label').allTextContents()).includes('urgent'));

// --- false-positive guard
await input.fill('Book the friday room for standup');
await input.press('Enter');
await page.waitForTimeout(120);
const afterFalsePositive = await page.locator('.todo__title').allTextContents();
check('mid-sentence date word untouched',
  afterFalsePositive.includes('Book the friday room for standup'),
  JSON.stringify(afterFalsePositive));

// --- complete + completed section
await page.locator('.todo').first().locator('.check').click();
await page.waitForTimeout(150);
check('completed leaves open list', (await page.locator('.todo-list .todo').count()) === 1);
check('completed section appears', await page.locator('.completed__toggle').isVisible());
await page.locator('.completed__toggle').click();
await page.waitForTimeout(120);
check('completed item shown greyed not struck',
  await page.locator('.completed .todo__title').first().isVisible());
const deco = await page.locator('.completed .todo__title').first()
  .evaluate((n) => getComputedStyle(n).textDecorationLine);
check('not struck through', deco === 'none', deco);

// --- undo delete
await page.locator('.completed__toggle').click();
for (const btn of await page.locator('.toast .icon-btn').all()) await btn.click().catch(() => {});
await page.waitForTimeout(100);
const before = await page.locator('.todo').count();
await page.locator('.todo').first().hover();
await page.locator('.todo').first().locator('.todo__actions .icon-btn').click();
await page.waitForTimeout(150);
check('delete removes row', (await page.locator('.todo').count()) === before - 1);
check('undo toast shown', await page.locator('.toast__action', { hasText: 'Undo' }).isVisible());
await page.locator('.toast__action', { hasText: 'Undo' }).click();
await page.waitForTimeout(150);
check('undo restores', (await page.locator('.todo').count()) === before);

// --- keyboard undo
await page.keyboard.press('Escape');
await page.locator('.todo').first().click();
await page.keyboard.press('Backspace');
await page.waitForTimeout(120);
const afterDel = await page.locator('.todo').count();
await page.keyboard.press('Control+z');
await page.waitForTimeout(150);
check('Ctrl+Z restores', (await page.locator('.todo').count()) === afterDel + 1);

// --- lists
await page.locator('.nav-section').nth(1).locator('.icon-btn').click();
await page.waitForSelector('dialog[open]');
await page.locator('dialog input').fill('Work');
await page.locator('dialog .btn--primary').click();
await page.waitForTimeout(200);
check('list created and switched to',
  (await page.locator('.topbar__title').textContent()) === 'Work');

await page.locator('.quickadd input').fill('Prep for review');
await page.locator('.quickadd input').press('Enter');
await page.waitForTimeout(150);
check('todo lands in current list', (await page.locator('.todo').count()) === 1);

// --- All shows everything
await page.locator('.nav-item').first().click();
await page.waitForTimeout(150);
// "Review deck" was completed above, so All shows the two remaining open
// todos ("Book the friday room..." and "Prep for review"), not all three
// ever created.
check('All view shows every list', (await page.locator('.todo').count()) >= 2);
check('list tag shown outside a list view', await page.locator('.todo__list-tag').first().isVisible());

// --- smart view
const todayNav = page.locator('.nav-item').nth(1);
await todayNav.click();
await page.waitForTimeout(150);
// Seed an item due today: "Review deck"'s "fri" due date is relative to
// whatever real day the suite happens to run on, so it cannot be relied on
// to land in Today.
await input.fill('Today seed');
await input.press('Enter');
await page.waitForTimeout(150);
check('Today view filters by date', (await page.locator('.todo').count()) >= 1);
const manualBtn = page.locator('.seg').nth(1).locator('button').first();
check('manual sort available in smart view', await manualBtn.isEnabled());
check('drag handle hidden by default in a date-sorted smart view',
  await page.locator('.todo__grip').first().evaluate((n) => getComputedStyle(n).visibility) === 'hidden');
await manualBtn.click();
await page.waitForTimeout(150);
check('drag handle appears once a smart view is switched to Manual',
  await page.locator('.todo__grip').first().evaluate((n) => getComputedStyle(n).visibility) !== 'hidden');
await page.locator('.seg').nth(1).locator('button').nth(1).click(); // back to By date
await page.waitForTimeout(150);

// --- grouping
await page.locator('.nav-item').first().click();
await page.waitForTimeout(120);
await page.locator('.seg').first().locator('button').nth(1).click();
await page.waitForTimeout(180);
check('group headers render', (await page.locator('.group__head').count()) >= 1);
const groupNames = await page.locator('.group__head').allTextContents();
check('No label group last', groupNames[groupNames.length - 1].includes('No label'), JSON.stringify(groupNames));

// --- search
await page.locator('.seg').first().locator('button').first().click();
await page.waitForTimeout(120);
await page.locator('#search-input').fill('Prep');
await page.waitForTimeout(200);
check('search filters', (await page.locator('.todo').count()) === 1);
await page.locator('#search-input').fill('zzzznope');
await page.waitForTimeout(200);
check('empty search state', await page.locator('.empty__title').isVisible());
await page.locator('#search-input').fill('');
await page.waitForTimeout(200);

// --- inline editing
await page.locator('.todo__title').first().click();
await page.waitForSelector('.editor');
await page.locator('.editor__title').fill('Renamed task');
await page.waitForTimeout(100);
await page.locator('.editor .btn--primary').click();
await page.waitForTimeout(180);
check('inline edit saves',
  (await page.locator('.todo__title').allTextContents()).includes('Renamed task'));

// --- persistence status
check('save status visible', await page.locator('.save-status').isVisible());
const status = await page.locator('.save-status').getAttribute('data-status');
check('status is cache-only before a file is attached', status === 'cache-only', status);

// --- reload keeps data
const countBefore = await page.locator('.todo').count();
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.todo');
check('data survives reload', (await page.locator('.todo').count()) === countBefore,
  `${countBefore} -> ${await page.locator('.todo').count()}`);

// --- dark mode
await page.emulateMedia({ colorScheme: 'dark' });
await page.waitForTimeout(120);
const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
check('dark theme applies', bg === 'rgb(22, 24, 29)', bg);
await page.emulateMedia({ colorScheme: 'light' });
await page.waitForTimeout(120);
}

{
console.log('\n# drag and drop');
// Start from a clean slate for the ordering checks.
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.quickadd input');


const add = async (text) => {
  await page.locator('.quickadd input').fill(text);
  await page.locator('.quickadd input').press('Enter');
  await page.waitForTimeout(90);
};

await add('Alpha');
await add('Bravo');
await add('Charlie');
check('seeded in order', JSON.stringify(await titles()) === '["Alpha","Bravo","Charlie"]',
  JSON.stringify(await titles()));

// --- native HTML5 drag: Charlie onto Alpha (drop above) -------------------
async function dragTodo(fromText, toText, { top = true } = {}) {
  await page.evaluate(({ fromText, toText, top }) => {
    const rows = [...document.querySelectorAll('.todo[data-id]')];
    const from = rows.find((r) => r.querySelector('.todo__title')?.textContent === fromText);
    const to = rows.find((r) => r.querySelector('.todo__title')?.textContent === toText);
    const dt = new DataTransfer();
    from.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    const rect = to.getBoundingClientRect();
    const clientY = top ? rect.top + 3 : rect.bottom - 3;
    const opts = { dataTransfer: dt, bubbles: true, cancelable: true, clientY, clientX: rect.left + 40 };
    to.dispatchEvent(new DragEvent('dragover', opts));
    to.dispatchEvent(new DragEvent('drop', opts));
    from.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true }));
  }, { fromText, toText, top });
  await page.waitForTimeout(150);
}

await dragTodo('Charlie', 'Alpha', { top: true });
check('drag to top reorders', JSON.stringify(await titles()) === '["Charlie","Alpha","Bravo"]',
  JSON.stringify(await titles()));

await dragTodo('Charlie', 'Bravo', { top: false });
check('drag to bottom reorders', JSON.stringify(await titles()) === '["Alpha","Bravo","Charlie"]',
  JSON.stringify(await titles()));

// --- drag onto a sidebar list = move between lists ------------------------
await page.locator('.nav-section').nth(1).locator('.icon-btn').click();
await page.waitForSelector('dialog[open]');
await page.locator('dialog input').fill('Work');
await page.locator('dialog .btn--primary').click();
await page.waitForTimeout(200);
await page.locator('.nav-item').first().click(); // back to All
await page.waitForTimeout(150);

await page.evaluate(() => {
  const row = [...document.querySelectorAll('.todo[data-id]')]
    .find((r) => r.querySelector('.todo__title').textContent === 'Bravo');
  const target = [...document.querySelectorAll('.nav-item__label')]
    .find((n) => n.textContent === 'Work').closest('.nav-item');
  const dt = new DataTransfer();
  row.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
  target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
  target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  row.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true }));
});
await page.waitForTimeout(200);
await page.locator('.nav-item__label', { hasText: 'Work' }).click();
await page.waitForTimeout(180);
const inWork = await page.locator('.todo-list .todo__title').allTextContents();
check('drag onto sidebar list moves it', JSON.stringify(inWork) === '["Bravo"]', JSON.stringify(inWork));
await page.locator('.nav-item').first().click();
await page.waitForTimeout(150);

// --- drag onto a label group header = relabel -----------------------------
await page.locator('.nav-section').nth(2).locator('.icon-btn').click();
await page.waitForSelector('dialog[open]');
await page.locator('dialog input').fill('urgent');
await page.locator('dialog .btn--primary').click();
await page.waitForTimeout(200);

await page.locator('.seg').first().locator('button').nth(1).click(); // group by label
await page.waitForTimeout(200);
const heads = await page.locator('.group__head').allTextContents();
check('grouped view shows label + No label', heads.length === 2, JSON.stringify(heads));

await page.evaluate(() => {
  const row = [...document.querySelectorAll('.todo[data-id]')]
    .find((r) => r.querySelector('.todo__title').textContent === 'Alpha');
  const group = [...document.querySelectorAll('.group')]
    .find((g) => g.querySelector('.group__head')?.textContent.includes('urgent'));
  const dt = new DataTransfer();
  row.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
  group.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
  group.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  row.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true }));
});
await page.waitForTimeout(200);
const urgentGroup = await page.locator('.group').filter({ hasText: 'urgent' }).locator('.todo__title').allTextContents();
check('drag onto group header relabels', urgentGroup.includes('Alpha'), JSON.stringify(urgentGroup));

// --- drag onto a row inside a label section (not the header) also relabels
await page.locator('.quickadd input').fill('Delta');
await page.locator('.quickadd input').press('Enter');
await page.waitForTimeout(150);
await dragTodo('Delta', 'Alpha', { top: true });
const urgentAfterRowDrop = await page.locator('.group').filter({ hasText: 'urgent' }).locator('.todo__title').allTextContents();
check('drag onto a row inside a label section relabels', urgentAfterRowDrop.includes('Delta'),
  JSON.stringify(urgentAfterRowDrop));

// --- drag from a smart view (not reorderable) still moves the todo --------
// The grip hides in a date-sorted view (see 'drag handle hidden in smart
// view'), but the row itself must stay draggable so it can still be moved to
// a different list or label from Today/Upcoming/Overdue.
await page.locator('.seg').first().locator('button').first().click(); // flat
await page.waitForTimeout(120);
await page.locator('.quickadd input').fill('Echo today');
await page.locator('.quickadd input').press('Enter');
await page.waitForTimeout(150);

await page.locator('.nav-item').nth(1).click(); // Today
await page.waitForTimeout(150);

const echoDraggable = await page.evaluate(() => {
  const row = [...document.querySelectorAll('.todo[data-id]')]
    .find((r) => r.querySelector('.todo__title')?.textContent === 'Echo');
  return row?.draggable;
});
check('row stays draggable in a smart view', echoDraggable === true, String(echoDraggable));

await page.evaluate(() => {
  const row = [...document.querySelectorAll('.todo[data-id]')]
    .find((r) => r.querySelector('.todo__title').textContent === 'Echo');
  const target = [...document.querySelectorAll('.nav-item__label')]
    .find((n) => n.textContent === 'Work').closest('.nav-item');
  const dt = new DataTransfer();
  row.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
  target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
  target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  row.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true }));
});
await page.waitForTimeout(200);
await page.locator('.nav-item__label', { hasText: 'Work' }).click();
await page.waitForTimeout(180);
const workTitlesFromToday = await page.locator('.todo-list .todo__title').allTextContents();
check('drag from Today view onto sidebar list moves it',
  workTitlesFromToday.includes('Echo'), JSON.stringify(workTitlesFromToday));

// Relabelling by dropping on a group header from a smart view.
await page.locator('.nav-item').nth(1).click(); // Today
await page.waitForTimeout(150);
await page.locator('.seg').first().locator('button').nth(1).click(); // group by label
await page.waitForTimeout(180);

await page.evaluate(() => {
  const row = [...document.querySelectorAll('.todo[data-id]')]
    .find((r) => r.querySelector('.todo__title').textContent === 'Echo');
  const group = [...document.querySelectorAll('.group')]
    .find((g) => g.querySelector('.group__head')?.textContent.includes('urgent'));
  const dt = new DataTransfer();
  row.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
  group.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
  group.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  row.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true }));
});
await page.waitForTimeout(200);
const urgentFromToday = await page.locator('.group').filter({ hasText: 'urgent' }).locator('.todo__title').allTextContents();
check('drag onto a label group header from a smart view relabels',
  urgentFromToday.includes('Echo'), JSON.stringify(urgentFromToday));
await page.locator('.seg').first().locator('button').first().click(); // back to flat

// --- keyboard reorder (Alt+arrows) ---------------------------------------
await page.locator('.seg').first().locator('button').first().click();
await page.locator('.nav-item').first().click();
await page.waitForTimeout(180);
const before = await titles();
await page.locator('.todo').first().click();
await page.keyboard.press('Alt+ArrowDown');
await page.waitForTimeout(200);
const after = await titles();
check('Alt+ArrowDown moves a todo down',
  after[0] === before[1] && after[1] === before[0], `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
await page.keyboard.press('Alt+ArrowUp');
await page.waitForTimeout(200);
check('Alt+ArrowUp moves it back', JSON.stringify(await titles()) === JSON.stringify(before),
  JSON.stringify(await titles()));
}

console.log('\n# smart view manual override');
{
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.quickadd input');

  await page.locator('.nav-item').nth(1).click(); // Today
  await page.waitForTimeout(150);

  const add = async (text) => {
    await page.locator('.quickadd input').fill(text);
    await page.locator('.quickadd input').press('Enter');
    await page.waitForTimeout(90);
  };
  await add('Alpha');
  await add('Bravo');
  await add('Charlie');
  await page.waitForTimeout(150);

  // Manual sort is off by default in a smart view — dragging must not reorder yet.
  const beforeManual = await titles();
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.todo[data-id]')];
    const from = rows.find((r) => r.querySelector('.todo__title')?.textContent === 'Charlie');
    const to = rows.find((r) => r.querySelector('.todo__title')?.textContent === 'Alpha');
    const dt = new DataTransfer();
    from.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    const rect = to.getBoundingClientRect();
    const opts = { dataTransfer: dt, bubbles: true, cancelable: true, clientY: rect.top + 3, clientX: rect.left + 40 };
    to.dispatchEvent(new DragEvent('dragover', opts));
    to.dispatchEvent(new DragEvent('drop', opts));
    from.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true }));
  });
  await page.waitForTimeout(150);
  check('date-sorted smart view ignores drag reorder',
    JSON.stringify(await titles()) === JSON.stringify(beforeManual), JSON.stringify(await titles()));

  const dueDatesBefore = await page.locator('.todo .due').allTextContents();

  // Switch to Manual so dragging is enabled.
  await page.locator('.seg').nth(1).locator('button').first().click();
  await page.waitForTimeout(150);

  async function dragTodo(fromText, toText, { top = true } = {}) {
    await page.evaluate(({ fromText, toText, top }) => {
      const rows = [...document.querySelectorAll('.todo[data-id]')];
      const from = rows.find((r) => r.querySelector('.todo__title')?.textContent === fromText);
      const to = rows.find((r) => r.querySelector('.todo__title')?.textContent === toText);
      const dt = new DataTransfer();
      from.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
      const rect = to.getBoundingClientRect();
      const clientY = top ? rect.top + 3 : rect.bottom - 3;
      const opts = { dataTransfer: dt, bubbles: true, cancelable: true, clientY, clientX: rect.left + 40 };
      to.dispatchEvent(new DragEvent('dragover', opts));
      to.dispatchEvent(new DragEvent('drop', opts));
      from.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true }));
    }, { fromText, toText, top });
    await page.waitForTimeout(150);
  }

  await dragTodo('Charlie', 'Alpha', { top: true });
  check('drag overrides display order once a smart view is switched to Manual',
    JSON.stringify(await titles()) === '["Charlie","Alpha","Bravo"]', JSON.stringify(await titles()));

  const dueDatesAfter = await page.locator('.todo .due').allTextContents();
  check('due dates untouched by a manual-order drag in a smart view',
    JSON.stringify(dueDatesBefore) === JSON.stringify(dueDatesAfter),
    JSON.stringify({ dueDatesBefore, dueDatesAfter }));

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.todo');
  check('manual order in a smart view survives reload',
    JSON.stringify(await titles()) === '["Charlie","Alpha","Bravo"]', JSON.stringify(await titles()));
}

console.log('\n# label group reorder');
{
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.quickadd input');

  const add = async (text) => {
    await page.locator('.quickadd input').fill(text);
    await page.locator('.quickadd input').press('Enter');
    await page.waitForTimeout(90);
  };

  async function createLabel(name) {
    await page.locator('.nav-section').nth(2).locator('.icon-btn').click();
    await page.waitForSelector('dialog[open]');
    await page.locator('dialog input').fill(name);
    await page.locator('dialog .btn--primary').click();
    await page.waitForTimeout(200);
  }
  await createLabel('Urgent');
  await createLabel('Someday');

  await add('Task A #Urgent');
  await add('Task B #Someday');

  await page.locator('.nav-item').first().click(); // All
  await page.waitForTimeout(120);
  await page.locator('.seg').first().locator('button').nth(1).click(); // group by label
  await page.waitForTimeout(180);

  const headsBefore = await page.locator('.group__head').allTextContents();
  check('label groups render in creation order before reordering',
    headsBefore[0].includes('Urgent') && headsBefore[1].includes('Someday'), JSON.stringify(headsBefore));

  async function dragGroup(fromText, toText, { top = true } = {}) {
    await page.evaluate(({ fromText, toText, top }) => {
      const heads = [...document.querySelectorAll('.group__head')];
      const from = heads.find((h) => h.textContent.includes(fromText));
      const to = heads.find((h) => h.textContent.includes(toText));
      const dt = new DataTransfer();
      from.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
      const rect = to.getBoundingClientRect();
      const clientY = top ? rect.top + 3 : rect.bottom - 3;
      const opts = { dataTransfer: dt, bubbles: true, cancelable: true, clientY, clientX: rect.left + 40 };
      to.dispatchEvent(new DragEvent('dragover', opts));
      to.dispatchEvent(new DragEvent('drop', opts));
      from.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true }));
    }, { fromText, toText, top });
    await page.waitForTimeout(150);
  }

  await dragGroup('Someday', 'Urgent', { top: true });
  const headsAfter = await page.locator('.group__head').allTextContents();
  check('dragging a group header reorders label groups',
    headsAfter[0].includes('Someday') && headsAfter[1].includes('Urgent'), JSON.stringify(headsAfter));

  // Regression guard: dropping a *todo* on a header must still relabel, not
  // be mistaken for a group-header drag (the two gestures share an element).
  await add('Task C');
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.todo[data-id]')]
      .find((r) => r.querySelector('.todo__title')?.textContent === 'Task C');
    const group = [...document.querySelectorAll('.group')]
      .find((g) => g.querySelector('.group__head')?.textContent.includes('Urgent'));
    const dt = new DataTransfer();
    row.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    group.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    group.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    row.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true }));
  });
  await page.waitForTimeout(200);
  const urgentTitles = await page.locator('.group').filter({ hasText: 'Urgent' }).locator('.todo__title').allTextContents();
  const headsStillOrdered = await page.locator('.group__head').allTextContents();
  check('dropping a todo on a header still relabels rather than reordering groups',
    urgentTitles.includes('Task C') && headsStillOrdered[0].includes('Someday'),
    JSON.stringify({ urgentTitles, headsStillOrdered }));

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.group__head');
  const headsAfterReload = await page.locator('.group__head').allTextContents();
  check('label group order survives reload',
    headsAfterReload[0].includes('Someday') && headsAfterReload[1].includes('Urgent'),
    JSON.stringify(headsAfterReload));
}

console.log('\n# focus and selection');
{
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.quickadd input');

  const add = async (text) => {
    await page.locator('.quickadd input').fill(text);
    await page.locator('.quickadd input').press('Enter');
    await page.waitForTimeout(90);
  };
  await add('Alpha report');
  await add('Bravo memo');

  // Typing character by character: fill() sets the value in one shot and
  // would not catch the input being recreated on each keystroke.
  await page.locator('#search-input').click();
  await page.keyboard.type('Alpha', { delay: 30 });
  await page.waitForTimeout(150);

  const focused = await page.evaluate(() => document.activeElement?.id);
  check('search keeps focus while typing', focused === 'search-input', String(focused));
  check('search value survives typing',
    (await page.locator('#search-input').inputValue()) === 'Alpha',
    await page.locator('#search-input').inputValue());
  check('search filters as you type',
    (await page.locator('.todo-list .todo').count()) === 1);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  check('Escape clears search', (await page.locator('.todo-list .todo').count()) === 2);

  // Clicking a row must show the selection, not just record it internally.
  // Click the grip column: the title span fills the row width and is
  // deliberately click-to-edit.
  await page.locator('.todo').first().click({ position: { x: 6, y: 14 } });
  await page.waitForTimeout(120);
  check('clicking a row highlights it',
    await page.locator('.todo').first().evaluate((n) => n.classList.contains('is-selected')));

  await page.locator('.todo').nth(1).click({ position: { x: 6, y: 14 } });
  await page.waitForTimeout(120);
  check('selection moves to the clicked row',
    (await page.locator('.todo.is-selected').count()) === 1 &&
    await page.locator('.todo').nth(1).evaluate((n) => n.classList.contains('is-selected')));

  // Editing must not be torn down by an unrelated repaint.
  await page.locator('.todo__title').first().click();
  await page.waitForSelector('.editor');
  await page.locator('.editor__title').click();
  await page.keyboard.type(' edited', { delay: 20 });
  const stillEditing = await page.evaluate(() => document.activeElement?.className);
  check('inline editor keeps focus while typing',
    String(stillEditing).includes('editor__title'), String(stillEditing));
  await page.locator('.editor .btn--primary').click();
  await page.waitForTimeout(150);
  check('edit with typed text saves',
    (await page.locator('.todo__title').allTextContents()).some((t) => t.endsWith(' edited')),
    JSON.stringify(await page.locator('.todo__title').allTextContents()));
}

console.log(`\n${failures ? failures + ' failing check(s)' : 'all checks passed'}`);
if (errors.length) console.log('console errors:', errors);
await browser.close();
server.kill();
process.exit(failures || errors.length ? 1 : 0);
