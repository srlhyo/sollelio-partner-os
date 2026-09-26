import { afterAll, describe, expect, it } from 'vitest';
import {
  formatDateTime,
  formatDueLong,
  formatDueShort,
  formatEffort,
  fromDateInput,
  isPast,
  resolveDueForSave,
  toDateInput,
} from './format';

describe('formatEffort', () => {
  it('shows the smallest honest estimate as <1 min, never "1 min"', () => {
    expect(formatEffort(1)).toBe('<1 min');
    expect(formatEffort(1)).not.toContain('~1');
  });
  it('shows the onboarding baseline as ~3 min', () => {
    expect(formatEffort(3)).toBe('~3 min');
  });
  it('shows larger estimates as approximations', () => {
    expect(formatEffort(15)).toBe('~15 min');
  });
});

/*
 * Deadlines are Lisbon days whatever the browser's zone. Node applies a change to
 * process.env.TZ immediately, so the same assertions run as a browser in Lisbon, in
 * São Paulo and elsewhere; the first check proves the zone really changed.
 */
const ORIGINAL_TZ = process.env.TZ;
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

const BROWSER_ZONES: [string, number][] = [
  // [zone, expected getTimezoneOffset() on 2026-07-15 — proof the zone is in force]
  ['Europe/Lisbon', -60],
  ['America/Sao_Paulo', 180],
  ['UTC', 0],
  ['Asia/Tokyo', -540],
];

describe.each(BROWSER_ZONES)('deadlines in Europe/Lisbon, browser in %s', (zone, julyOffset) => {
  const inZone = <T,>(run: () => T): T => {
    process.env.TZ = zone;
    return run();
  };

  it('really runs in that browser zone', () => {
    inZone(() => expect(new Date('2026-07-15T12:00:00Z').getTimezoneOffset()).toBe(julyOffset));
  });

  it('stores a chosen day as the end of that day in Lisbon — summer (UTC+1)', () => {
    inZone(() => expect(fromDateInput('2026-07-15')).toBe('2026-07-15T22:59:59.000Z'));
  });

  it('stores a chosen day as the end of that day in Lisbon — winter (UTC+0)', () => {
    inZone(() => expect(fromDateInput('2026-01-15')).toBe('2026-01-15T23:59:59.000Z'));
  });

  it('handles the spring change (29 Mar 2026): the day before is winter, the day itself summer', () => {
    inZone(() => {
      expect(fromDateInput('2026-03-28')).toBe('2026-03-28T23:59:59.000Z');
      expect(fromDateInput('2026-03-29')).toBe('2026-03-29T22:59:59.000Z');
    });
  });

  it('handles the autumn change (25 Oct 2026): the day before is summer, the day itself winter', () => {
    inZone(() => {
      expect(fromDateInput('2026-10-24')).toBe('2026-10-24T22:59:59.000Z');
      expect(fromDateInput('2026-10-25')).toBe('2026-10-25T23:59:59.000Z');
    });
  });

  it('round-trips every day of the year without moving the instant', () => {
    inZone(() => {
      for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 86_400_000) {
        const day = new Date(t).toISOString().slice(0, 10);
        const stored = fromDateInput(day);
        expect(toDateInput(stored)).toBe(day);
        expect(fromDateInput(toDateInput(stored))).toBe(stored);
      }
    });
  });

  it('shows the Lisbon day, even when the browser is already on another day', () => {
    inZone(() => {
      // 02:00 UTC on 15 July: 03:00 in Lisbon, but 23:00 on 14 July in São Paulo.
      const iso = '2026-07-15T02:00:00.000Z';
      expect(toDateInput(iso)).toBe('2026-07-15');
      expect(formatDueLong(iso, new Date('2026-07-01T12:00:00Z'))).toBe('até quarta, 15 jul');
      expect(formatDateTime(iso)).toBe('15 jul 2026, 03:00');
    });
  });

  it('names today, tomorrow and the weekday by Lisbon days', () => {
    inZone(() => {
      // "Now" is 23:30 in Lisbon on Tuesday 29 Sep (22:30 UTC); in São Paulo it is 19:30.
      const now = new Date('2026-09-29T22:30:00Z');
      expect(formatDueShort(fromDateInput('2026-09-29') ?? '', now)).toBe('até hoje');
      expect(formatDueShort(fromDateInput('2026-09-30') ?? '', now)).toBe('até amanhã');
      expect(formatDueShort(fromDateInput('2026-10-02') ?? '', now)).toBe('até sexta');
      expect(formatDueShort(fromDateInput('2026-10-14') ?? '', now)).toBe('até 14 out');
      expect(formatDueLong(fromDateInput('2026-09-30') ?? '', now)).toBe('até quarta, 30 set');
    });
  });

  it('says plainly when a deadline has passed', () => {
    inZone(() => {
      // 00:30 on 30 Sep in Lisbon (23:30 UTC on the 29th): the 29th is over in Lisbon.
      const now = new Date('2026-09-29T23:30:00Z');
      const due = fromDateInput('2026-09-29') ?? '';
      expect(isPast(due, now)).toBe(true);
      expect(formatDueShort(due, now)).toBe('prazo passou: 29 set');
      expect(formatDueLong(due, now)).toBe('o prazo era terça, 29 set');
    });
  });

  it('keeps a stored instant exactly when the day is not changed', () => {
    inZone(() => {
      const stored = '2026-07-15T10:00:00.000Z'; // any time, e.g. written by an earlier tool
      expect(resolveDueForSave('2026-07-15', stored)).toBe(stored);
      expect(resolveDueForSave('2026-07-16', stored)).toBe('2026-07-16T22:59:59.000Z');
      expect(resolveDueForSave('', stored)).toBeNull();
      expect(resolveDueForSave('2026-07-15', null)).toBe('2026-07-15T22:59:59.000Z');
    });
  });

  it('rejects malformed or impossible dates', () => {
    inZone(() => {
      expect(fromDateInput('')).toBeNull();
      expect(fromDateInput('2026-02-30')).toBeNull();
      expect(fromDateInput('15/07/2026')).toBeNull();
    });
  });
});
