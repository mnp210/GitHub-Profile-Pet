export interface CalendarCell {
  id: string; // Stable identifier: "contrib-YYYY-MM-DD"
  date: string; // ISO date format: "YYYY-MM-DD"
  dayOfWeek: number; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
  isToday: boolean;
  isFuture: boolean;
}

export interface MonthHeaderLabel {
  label: string; // e.g. "Nov", "Dec", "Jan '27"
  colIndex: number; // Column index (0 to weeks - 1)
  month: number; // 0 to 11
  year: number; // Full year (e.g. 2026)
}

export interface GeneratedCalendarGrid {
  weeks: CalendarCell[][];
  monthLabels: MonthHeaderLabel[];
  totalContributions: number;
  startDate: string;
  endDate: string;
}

export interface GenerateCalendarOptions {
  referenceDate?: Date; // Defaults to current UTC date
  weeksCount?: number; // Defaults to 26 weeks (approx. 6 months)
  simulated?: boolean; // When true, generates illustrative DEMO counts
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Format a Date to a standardized UTC YYYY-MM-DD string.
 * This guarantees consistent day boundaries without daylight saving shifts.
 */
export function formatUtcIsoDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Create a UTC Date at midnight (00:00:00.000Z) from a YYYY-MM-DD string or Date object.
 */
export function toUtcDate(input: string | Date): Date {
  if (typeof input === 'string') {
    const [y, m, d] = input.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  }
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate(), 0, 0, 0, 0));
}

/**
 * Deterministic pseudo-random contribution intensity for simulated demo mode.
 * Generates believable commit streaks based on date string hash.
 */
export function getSimulatedDayContribution(dateIso: string, daysAgo: number): { count: number; level: 0 | 1 | 2 | 3 | 4 } {
  // Simple stable string hash
  let hash = 0;
  for (let i = 0; i < dateIso.length; i++) {
    hash = (hash << 5) - hash + dateIso.charCodeAt(i);
    hash |= 0;
  }
  const positiveHash = Math.abs(hash);

  // Active coding streak in the most recent 14-28 days
  const isRecentStreak = daysAgo <= 28;
  const activityChance = isRecentStreak ? 80 : 55;
  const roll = positiveHash % 100;

  if (roll > (100 - activityChance)) {
    const count = (positiveHash % 9) + 1;
    const level: 0 | 1 | 2 | 3 | 4 = count >= 7 ? 4 : count >= 5 ? 3 : count >= 3 ? 2 : 1;
    return { count, level };
  }

  return { count: 0, level: 0 };
}

/**
 * Generates a calendar-aware, aligned 2D grid of contribution weeks (Sunday to Saturday)
 * relative to the reference date, with proper leap year handling and month boundary labels.
 */
export function generateContributionGrid(options: GenerateCalendarOptions = {}): GeneratedCalendarGrid {
  const {
    referenceDate = new Date(),
    weeksCount = 26,
    simulated = true,
  } = options;

  const todayUtc = toUtcDate(referenceDate);
  const todayIso = formatUtcIsoDate(todayUtc);
  const todayDayOfWeek = todayUtc.getUTCDay(); // 0 = Sunday, 6 = Saturday

  // Calculate the Sunday of the current week
  const currentWeekSunday = new Date(todayUtc.getTime() - todayDayOfWeek * 86400000);

  // Go back (weeksCount - 1) weeks to find the grid's start Sunday
  const startSunday = new Date(currentWeekSunday.getTime() - (weeksCount - 1) * 7 * 86400000);

  const weeks: CalendarCell[][] = [];
  const monthLabels: MonthHeaderLabel[] = [];
  let totalContributions = 0;
  let lastLabeledCol = -4; // Ensure minimum 3-column spacing between month labels

  for (let w = 0; w < weeksCount; w++) {
    const weekCells: CalendarCell[] = [];
    const weekSunday = new Date(startSunday.getTime() + w * 7 * 86400000);

    // Track month label for this column: check if this week contains the 1st of a month
    // or if it's the very first column of the grid
    let monthLabelForCol: MonthHeaderLabel | null = null;

    for (let d = 0; d < 7; d++) {
      const cellDate = new Date(weekSunday.getTime() + d * 86400000);
      const cellIso = formatUtcIsoDate(cellDate);
      const isToday = cellIso === todayIso;
      const isFuture = cellDate.getTime() > todayUtc.getTime();

      const daysAgo = Math.round((todayUtc.getTime() - cellDate.getTime()) / 86400000);

      let count = 0;
      let level: 0 | 1 | 2 | 3 | 4 = 0;

      if (!isFuture && simulated) {
        const sim = getSimulatedDayContribution(cellIso, daysAgo);
        count = sim.count;
        level = sim.level;
        totalContributions += count;
      }

      weekCells.push({
        id: `contrib-${cellIso}`,
        date: cellIso,
        dayOfWeek: cellDate.getUTCDay(),
        count,
        level,
        isToday,
        isFuture,
      });

      // Check if this day is the 1st day of a month
      if (cellDate.getUTCDate() === 1 && (w - lastLabeledCol >= 3 || w === 0)) {
        monthLabelForCol = {
          label: MONTH_NAMES[cellDate.getUTCMonth()],
          colIndex: w,
          month: cellDate.getUTCMonth(),
          year: cellDate.getUTCFullYear(),
        };
      }
    }

    // If first column and not labeled yet, label with its month
    if (w === 0 && !monthLabelForCol) {
      monthLabelForCol = {
        label: MONTH_NAMES[weekSunday.getUTCMonth()],
        colIndex: 0,
        month: weekSunday.getUTCMonth(),
        year: weekSunday.getUTCFullYear(),
      };
    }

    if (monthLabelForCol && w - lastLabeledCol >= 3) {
      monthLabels.push(monthLabelForCol);
      lastLabeledCol = w;
    }

    weeks.push(weekCells);
  }

  const startDateIso = formatUtcIsoDate(startSunday);
  const endDateIso = todayIso;

  return {
    weeks,
    monthLabels,
    totalContributions,
    startDate: startDateIso,
    endDate: endDateIso,
  };
}
