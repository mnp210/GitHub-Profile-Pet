/**
/**
 * GitHub Profile Pet - Integer Interval Range Index
 *
 * Provides ultra-compact, O(log N) lookup and O(1) space complexity for representing
 * arbitrary sets of positive sequential integers (GitHub issue numbers, PR numbers, review IDs).
 *
 * Example:
 *   Sequential IDs 1 through 50000 are compressed to a single interval: `[[1, 50000]]` (14 bytes).
 *   Disjoint IDs: `[[1, 100], [105, 200]]`
 */

export type IntegerInterval = [number, number]; // [start, end] inclusive

/**
 * Checks whether an integer exists within a list of disjoint, sorted intervals.
 */
export function isNumberInIntervals(intervals: IntegerInterval[] | undefined, target: number): boolean {
  if (!intervals || intervals.length === 0 || !Number.isInteger(target) || target <= 0) {
    return false;
  }

  let low = 0;
  let high = intervals.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const [start, end] = intervals[mid];

    if (target >= start && target <= end) {
      return true;
    }

    if (target < start) {
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return false;
}

/**
 * Inserts an integer into a list of sorted, disjoint intervals, merging adjacent or overlapping bounds.
 * Returns a new array of intervals.
 */
export function addNumberToIntervals(intervals: IntegerInterval[] | undefined, target: number): IntegerInterval[] {
  if (!Number.isInteger(target) || target <= 0) {
    return intervals ? [...intervals] : [];
  }

  if (!intervals || intervals.length === 0) {
    return [[target, target]];
  }

  // If already present, return early
  if (isNumberInIntervals(intervals, target)) {
    return [...intervals];
  }

  const result: IntegerInterval[] = [];
  let inserted = false;

  for (const interval of intervals) {
    const [start, end] = interval;

    if (inserted) {
      result.push(interval);
      continue;
    }

    if (target < start - 1) {
      // Sits strictly before current interval without touching
      result.push([target, target]);
      result.push(interval);
      inserted = true;
    } else if (target === start - 1) {
      // Touches start from left
      result.push([target, end]);
      inserted = true;
    } else if (target <= end) {
      // Inside interval (already checked, but defensive)
      result.push(interval);
      inserted = true;
    } else if (target === end + 1) {
      // Touches end from right (might merge with next interval)
      result.push([start, target]);
      inserted = true;
    } else {
      // Sits strictly after current interval
      result.push(interval);
    }
  }

  if (!inserted) {
    result.push([target, target]);
  }

  // Merge any adjacent or overlapping intervals produced by the insertion
  const merged: IntegerInterval[] = [];
  for (const curr of result) {
    if (merged.length === 0) {
      merged.push(curr);
      continue;
    }

    const prev = merged[merged.length - 1];
    if (curr[0] <= prev[1] + 1) {
      // Overlaps or touches: extend previous interval
      prev[1] = Math.max(prev[1], curr[1]);
    } else {
      merged.push(curr);
    }
  }

  return merged;
}
