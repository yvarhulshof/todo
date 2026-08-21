// Date helpers. Everything user-facing is a local calendar date stored as
// "YYYY-MM-DD" — no times, no timezones, no UTC drift at midnight.

export const DAY_MS = 86400000;

/** Local calendar date of a Date object, as YYYY-MM-DD. */
export function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse YYYY-MM-DD into a local Date at midnight. */
export function fromISODate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function today() {
  return toISODate(new Date());
}

export function addDays(iso, n) {
  const d = fromISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/** Whole calendar days from today to `iso`. Negative means overdue. */
export function daysFromToday(iso, now = today()) {
  return Math.round((fromISODate(iso) - fromISODate(now)) / DAY_MS);
}

export function isValidISODate(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = fromISODate(iso);
  return toISODate(d) === iso;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Next occurrence of a weekday index. Bare "fri" typed on a Friday means
 * today, which is what people mean; "next fri" passes includeToday=false.
 */
export function nextWeekday(index, now = today(), includeToday = true) {
  const cur = fromISODate(now).getDay();
  let delta = (index - cur + 7) % 7;
  if (delta === 0 && !includeToday) delta = 7;
  return addDays(now, delta);
}

export function weekdayIndex(name) {
  const n = name.toLowerCase();
  const i = WEEKDAYS.findIndex((w) => w === n || w.slice(0, 3) === n);
  return i === -1 ? null : i;
}

/** Short human label: Today, Tomorrow, Fri, 24 Dec, 24 Dec 2027. */
export function formatDue(iso, now = today()) {
  const delta = daysFromToday(iso, now);
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  if (delta === -1) return 'Yesterday';
  const d = fromISODate(iso);
  if (delta > 1 && delta < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
  const sameYear = d.getFullYear() === fromISODate(now).getFullYear();
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** Grouping label for the Completed section. */
export function formatCompletedGroup(isoTimestamp, now = today()) {
  const iso = toISODate(new Date(isoTimestamp));
  const delta = daysFromToday(iso, now);
  if (delta === 0) return 'Today';
  if (delta === -1) return 'Yesterday';
  if (delta > -7) return 'Earlier this week';
  if (delta > -30) return 'Earlier this month';
  return fromISODate(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function dueTone(iso, now = today()) {
  const delta = daysFromToday(iso, now);
  if (delta < 0) return 'overdue';
  if (delta === 0) return 'today';
  return 'future';
}
