// Quick-add parsing: "Review deck fri #urgent" -> title + due date + label.
//
// Deliberate constraint: date tokens are only recognised at the END of the
// input. "Review deck fri" sets a date; "Book the Friday room" does not get
// mangled. Predictability beats cleverness — the same principle as disabling
// drag in a date-sorted view.
//
// #label tokens are recognised anywhere, because "#" is unambiguous.

import { today, addDays, nextWeekday, weekdayIndex, isValidISODate, toISODate } from './dates.js';

const LABEL_RE = /(^|\s)#([^\s#]+)/g;

/** Resolve one trailing word to a date, or null. */
function wordToDate(word, now) {
  const w = word.toLowerCase();

  if (w === 'today' || w === 'tod') return now;
  if (w === 'tomorrow' || w === 'tom' || w === 'tmr') return addDays(now, 1);

  const wd = weekdayIndex(w);
  if (wd !== null) return nextWeekday(wd, now);

  // Relative offsets: 3d, 2w
  const rel = /^(\d{1,3})([dw])$/.exec(w);
  if (rel) {
    const n = Number(rel[1]);
    if (n > 0) return addDays(now, rel[2] === 'd' ? n : n * 7);
  }

  // Full ISO
  if (isValidISODate(w)) return w;

  // Day/month, with optional year: 24/12, 24-12, 24/12/2027
  const dmy = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?$/.exec(w);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    if (day < 1 || day > 31 || month < 1 || month > 12) return null;
    let year;
    if (dmy[3]) {
      year = Number(dmy[3]);
      if (year < 100) year += 2000;
    } else {
      // No year given: pick the next occurrence, so "24/12" in January
      // means this year, but in December means next year.
      year = Number(now.slice(0, 4));
      const candidate = new Date(year, month - 1, day);
      if (toISODate(candidate) < now) year += 1;
    }
    const d = new Date(year, month - 1, day);
    if (d.getMonth() !== month - 1 || d.getDate() !== day) return null; // e.g. 31/02
    return toISODate(d);
  }

  return null;
}

/** Two-word trailing phrases. */
function phraseToDate(a, b, now) {
  const first = a.toLowerCase();
  if (first === 'next') {
    const second = b.toLowerCase();
    if (second === 'week') return addDays(now, 7);
    if (second === 'month') return addDays(now, 30);
    const wd = weekdayIndex(second);
    if (wd !== null) return nextWeekday(wd, now, false);
  }
  if (first === 'in') {
    const rel = /^(\d{1,3})([dw])$/.exec(b.toLowerCase());
    if (rel) return addDays(now, rel[2] === 'd' ? Number(rel[1]) : Number(rel[1]) * 7);
  }
  return null;
}

/**
 * @param {string} input
 * @param {Array<{id:string,name:string}>} labels existing labels
 * @returns {{title:string, dueDate:string|null, labelId:string|null,
 *            newLabelName:string|null, chips:Array<{type:string,text:string}>}}
 */
export function parseQuickAdd(input, labels = [], now = today()) {
  const chips = [];
  let labelId = null;
  let newLabelName = null;

  // 1. Pull out #label tokens from anywhere. Single-label model: last one wins.
  let rest = input;
  const labelMatches = [...input.matchAll(LABEL_RE)];
  if (labelMatches.length) {
    const name = labelMatches[labelMatches.length - 1][2];
    const existing = labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      labelId = existing.id;
      chips.push({ type: 'label', text: existing.name });
    } else {
      newLabelName = name;
      chips.push({ type: 'new-label', text: name });
    }
    rest = input.replace(LABEL_RE, '$1').trim();
  }

  // 2. Look for a date in the trailing words only.
  let dueDate = null;
  const words = rest.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    const last = words[words.length - 1];
    const secondLast = words[words.length - 2];

    const phrase = words.length > 2 ? phraseToDate(secondLast, last, now) : null;
    if (phrase) {
      dueDate = phrase;
      words.splice(-2, 2);
      chips.push({ type: 'date', text: `${secondLast} ${last}`, value: phrase });
    } else {
      const single = wordToDate(last, now);
      if (single) {
        dueDate = single;
        words.pop();
        chips.push({ type: 'date', text: last, value: single });
      }
    }
  }

  return {
    title: words.join(' ').trim(),
    dueDate,
    labelId,
    newLabelName,
    chips,
  };
}
