/**
 * Presentation of effort and deadlines (02_OPERATING_MODEL.md §2, 03_UX_SPEC.md §4).
 *
 * Deadlines live in one operational time zone, Europe/Lisbon, whatever the viewer's
 * browser says (05_DATA_MODEL_AND_API.md §4, "Deadlines"). A chosen day means the end
 * of that day in Lisbon, including across the summer-time changes, so the same
 * deadline shows the same day in Portugal and in Brazil. Offsets are never fixed:
 * they come from the time-zone database through Intl.
 *
 * Deterministic pt-PT words instead of Intl month/weekday names, so the copy is
 * exactly what the UX specification shows ("até sexta", "30 set") on every browser.
 */
export const OPERATIONAL_TIME_ZONE = 'Europe/Lisbon';

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** The smallest honest estimate reads as trivially small: 1 is "<1 min", never "1 min". */
export function formatEffort(minutes: number): string {
  if (minutes <= 1) return '<1 min';
  return `~${minutes} min`;
}

interface CalendarDay {
  year: number;
  month: number; // 1–12
  day: number;
}

interface WallTime extends CalendarDay {
  hour: number;
  minute: number;
  second: number;
}

const lisbonParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: OPERATIONAL_TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  hourCycle: 'h23',
});

/** The wall-clock time in Lisbon at an instant. */
function lisbonWallTime(instant: Date): WallTime {
  const parts: Record<string, number> = {};
  for (const part of lisbonParts.formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year ?? 0,
    month: parts.month ?? 0,
    day: parts.day ?? 0,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

/** Lisbon's offset from UTC at an instant, in milliseconds (0 in winter, +1 h in summer). */
function lisbonOffsetMs(instant: Date): number {
  const w = lisbonWallTime(instant);
  const wallAsUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return wallAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** A Lisbon calendar day as a comparable day number, independent of the viewer. */
function dayNumber(day: CalendarDay): number {
  return Math.round(Date.UTC(day.year, day.month - 1, day.day) / 86_400_000);
}

function weekdayOf(day: CalendarDay): string {
  return WEEKDAYS[new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay()] ?? '';
}

function lisbonDay(instant: Date): CalendarDay {
  const { year, month, day } = lisbonWallTime(instant);
  return { year, month, day };
}

function dayDifference(due: Date, now: Date): number {
  return dayNumber(lisbonDay(due)) - dayNumber(lisbonDay(now));
}

/** "30 set", for the Lisbon day of an instant. */
export function shortDate(date: Date): string {
  const d = lisbonDay(date);
  return `${d.day} ${MONTHS[d.month - 1]}`;
}

/** "quarta, 30 set", for the Lisbon day of an instant. */
export function longDate(date: Date): string {
  const d = lisbonDay(date);
  return `${weekdayOf(d)}, ${d.day} ${MONTHS[d.month - 1]}`;
}

export function isPast(iso: string, now: Date = new Date()): boolean {
  return dayDifference(new Date(iso), now) < 0;
}

/** Card form: "até hoje", "até amanhã", "até sexta", then "até 30 set". */
export function formatDueShort(iso: string, now: Date = new Date()): string {
  const due = new Date(iso);
  const days = dayDifference(due, now);
  if (days < 0) return `prazo passou: ${shortDate(due)}`;
  if (days === 0) return 'até hoje';
  if (days === 1) return 'até amanhã';
  if (days <= 6) return `até ${weekdayOf(lisbonDay(due))}`;
  return `até ${shortDate(due)}`;
}

/** Detail form: always the weekday and the date. */
export function formatDueLong(iso: string, now: Date = new Date()): string {
  const due = new Date(iso);
  if (dayDifference(due, now) < 0) return `o prazo era ${longDate(due)}`;
  return `até ${longDate(due)}`;
}

/** A timestamp for internal lists and history, in Lisbon time. */
export function formatDateTime(iso: string): string {
  const w = lisbonWallTime(new Date(iso));
  return `${w.day} ${MONTHS[w.month - 1]} ${w.year}, ${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')}`;
}

/** The date-input value (YYYY-MM-DD) of a stored deadline: its day in Lisbon. */
export function toDateInput(iso: string | null): string {
  if (!iso) return '';
  const d = lisbonDay(new Date(iso));
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

/**
 * The stored deadline for a chosen day: 23:59:59 of that day in Lisbon. The offset
 * is looked up for that very day, so summer and winter both land on the right
 * instant; transitions happen at 01:00 UTC, never near the end of a day.
 */
export function fromDateInput(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const wallAsUtc = Date.UTC(year, month - 1, day, 23, 59, 59);
  let instant = wallAsUtc - lisbonOffsetMs(new Date(wallAsUtc));
  // Re-check with the offset at the candidate itself (defensive; converges at once).
  instant = wallAsUtc - lisbonOffsetMs(new Date(instant));
  const check = lisbonWallTime(new Date(instant));
  if (check.year !== year || check.month !== month || check.day !== day) return null;
  return new Date(instant).toISOString();
}

/**
 * The deadline to send when saving. An unchanged day keeps the stored instant
 * exactly, whatever time it carried; only a different day is converted.
 */
export function resolveDueForSave(dateInput: string, originalIso: string | null): string | null {
  if (!dateInput) return null;
  if (originalIso && toDateInput(originalIso) === dateInput) return originalIso;
  return fromDateInput(dateInput);
}
