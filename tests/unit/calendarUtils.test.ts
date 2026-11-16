import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateContributionGrid,
  formatUtcIsoDate,
  toUtcDate,
} from '../../src/lib/github/calendarUtils.ts';

describe('Calendar-Aware Contribution Grid Generator', () => {
  test('aligns weeks correctly with Sunday as row 0 and Saturday as row 6', () => {
    const fixedToday = new Date('2026-11-15T00:00:00Z'); // Sunday
    const calendar = generateContributionGrid({
      referenceDate: fixedToday,
      weeksCount: 26,
    });

    assert.strictEqual(calendar.weeks.length, 26, 'Should generate exactly 26 columns of weeks');

    calendar.weeks.forEach((week, wIdx) => {
      assert.strictEqual(week.length, 7, `Week ${wIdx} should contain exactly 7 day rows`);
      assert.strictEqual(week[0].dayOfWeek, 0, `Week ${wIdx} row 0 must be Sunday (0)`);
      assert.strictEqual(week[1].dayOfWeek, 1, `Week ${wIdx} row 1 must be Monday (1)`);
      assert.strictEqual(week[6].dayOfWeek, 6, `Week ${wIdx} row 6 must be Saturday (6)`);
    });
  });

  test('generates consecutive dates without gaps and provides stable identifiers', () => {
    const fixedToday = new Date('2026-11-15T00:00:00Z');
    const calendar = generateContributionGrid({
      referenceDate: fixedToday,
      weeksCount: 10,
    });

    const flattened = calendar.weeks.flat();
    assert.strictEqual(flattened.length, 70, '10 weeks should yield 70 continuous day cells');

    for (let i = 0; i < flattened.length; i++) {
      const cell = flattened[i];
      assert.strictEqual(cell.id, `contrib-${cell.date}`, 'Cell id must be stable: contrib-YYYY-MM-DD');

      if (i > 0) {
        const prevTime = new Date(flattened[i - 1].date + 'T00:00:00Z').getTime();
        const currTime = new Date(cell.date + 'T00:00:00Z').getTime();
        const diffDays = Math.round((currTime - prevTime) / 86400000);
        assert.strictEqual(diffDays, 1, `Day ${cell.date} must be consecutive to ${flattened[i - 1].date}`);
      }
    }
  });

  test('correctly highlights the current date and flags future days', () => {
    // 2026-11-18 is Wednesday (dayOfWeek 3)
    const fixedWednesday = new Date('2026-11-18T00:00:00Z');
    const calendar = generateContributionGrid({
      referenceDate: fixedWednesday,
      weeksCount: 4,
    });

    const lastWeek = calendar.weeks[calendar.weeks.length - 1];
    
    // Wednesday should be row 3 and have isToday === true
    const wednesdayCell = lastWeek[3];
    assert.strictEqual(wednesdayCell.date, '2026-11-18');
    assert.strictEqual(wednesdayCell.isToday, true, 'Current date must have isToday === true');
    assert.strictEqual(wednesdayCell.isFuture, false);

    // Days before Wednesday in that week are past
    assert.strictEqual(lastWeek[0].isToday, false);
    assert.strictEqual(lastWeek[0].isFuture, false);

    // Days after Wednesday (Thu=4, Fri=5, Sat=6) are future days
    assert.strictEqual(lastWeek[4].isFuture, true, 'Thursday is in the future relative to Wednesday');
    assert.strictEqual(lastWeek[5].isFuture, true, 'Friday is in the future');
    assert.strictEqual(lastWeek[6].isFuture, true, 'Saturday is in the future');
  });

  test('accurately transitions across month and year boundaries', () => {
    // Reference date: January 15, 2026 (spans backwards into late 2025)
    const newYearRef = new Date('2026-01-15T00:00:00Z');
    const calendar = generateContributionGrid({
      referenceDate: newYearRef,
      weeksCount: 16,
    });

    assert.ok(calendar.startDate.startsWith('2025-'), 'Grid start date should span back into 2025');
    assert.ok(calendar.endDate.startsWith('2026-'), 'Grid end date should reach 2026');

    // Confirm Month Labels identify transition
    const labels = calendar.monthLabels.map(m => m.label);
    assert.ok(labels.includes('Jan'), 'Should include Jan label');
    assert.ok(labels.includes('Dec') || labels.includes('Nov'), 'Should include late 2025 month labels');

    // Confirm exactly one December 31, 2025 and January 1, 2026 in sequence
    const flattened = calendar.weeks.flat();
    const dec31 = flattened.find(c => c.date === '2025-12-31');
    const jan01 = flattened.find(c => c.date === '2026-01-01');

    assert.ok(dec31, 'December 31, 2025 must exist in grid');
    assert.ok(jan01, 'January 1, 2026 must exist in grid');
    const decIndex = flattened.indexOf(dec31!);
    const janIndex = flattened.indexOf(jan01!);
    assert.strictEqual(janIndex, decIndex + 1, 'Jan 1 must immediately follow Dec 31');
  });

  test('accurately handles leap years (February 29 inclusion)', () => {
    // 2024 is a leap year; test reference date March 5, 2024
    const leapYearRef = new Date('2024-03-05T00:00:00Z');
    const calendar = generateContributionGrid({
      referenceDate: leapYearRef,
      weeksCount: 8,
    });

    const flattened = calendar.weeks.flat();
    const leapDay = flattened.find(c => c.date === '2024-02-29');
    assert.ok(leapDay, '2024-02-29 (Leap Day) must exist in 2024 leap year grid');

    const feb28 = flattened.find(c => c.date === '2024-02-28');
    const mar01 = flattened.find(c => c.date === '2024-03-01');
    assert.ok(feb28);
    assert.ok(mar01);

    const feb28Index = flattened.indexOf(feb28!);
    const leapIndex = flattened.indexOf(leapDay!);
    const mar01Index = flattened.indexOf(mar01!);

    assert.strictEqual(leapIndex, feb28Index + 1, 'Feb 29 must follow Feb 28 in leap year');
    assert.strictEqual(mar01Index, leapIndex + 1, 'Mar 1 must follow Feb 29 in leap year');
  });

  test('correctly skips leap day in non-leap years (2025)', () => {
    // 2025 is not a leap year; test reference date March 5, 2025
    const nonLeapRef = new Date('2025-03-05T00:00:00Z');
    const calendar = generateContributionGrid({
      referenceDate: nonLeapRef,
      weeksCount: 8,
    });

    const flattened = calendar.weeks.flat();
    const leapDay = flattened.find(c => c.date === '2025-02-29');
    assert.strictEqual(leapDay, undefined, '2025-02-29 must NOT exist in non-leap year grid');

    const feb28 = flattened.find(c => c.date === '2025-02-28');
    const mar01 = flattened.find(c => c.date === '2025-03-01');
    assert.ok(feb28);
    assert.ok(mar01);

    const feb28Index = flattened.indexOf(feb28!);
    const mar01Index = flattened.indexOf(mar01!);
    assert.strictEqual(mar01Index, feb28Index + 1, 'Mar 1 must directly follow Feb 28 in non-leap year');
  });

  test('validates date formatting and UTC conversion helpers', () => {
    const utcDate = toUtcDate('2026-11-15');
    assert.strictEqual(utcDate.getUTCFullYear(), 2026);
    assert.strictEqual(utcDate.getUTCMonth(), 10); // 0-indexed November = 10
    assert.strictEqual(utcDate.getUTCDate(), 15);

    const formatted = formatUtcIsoDate(utcDate);
    assert.strictEqual(formatted, '2026-11-15');
  });
});
