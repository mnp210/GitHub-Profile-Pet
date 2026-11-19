/**
 * GitHub Profile Pet - Integer Interval Range Index
 *
 * Provides compact, disjoint interval representation for positive sequential integers
 * (GitHub issue numbers, PR numbers, review IDs).
 *
 * Formal Complexity:
 * - Lookup: O(log K) via binary search, where K is the number of disjoint stored intervals.
 * - Storage: O(K) memory, where K is the number of stored disjoint intervals.
 * - Density Behavior:
 *     - Contiguous sequences (e.g. 1 through 50,000) collapse into a single interval: `[[1, 50000]]` (K = 1, O(1) space).
 *     - Sparse or alternating sequences (e.g. 1, 3, 5, 7, ...) produce K separate intervals (O(K) space).
 *
 * Invariants:
 * - Intervals are always non-overlapping, strictly disjoint, and sorted in ascending order.
 * - Every interval [start, end] satisfies 1 <= start <= end <= Number.MAX_SAFE_INTEGER.
 */

export type IntegerInterval = [number, number]; // [start, end] inclusive

/**
 * Checks whether a positive integer exists within a list of disjoint, sorted intervals.
 * Time complexity: O(log K) where K = intervals.length.
 */
export function isNumberInIntervals(intervals: IntegerInterval[] | undefined, target: number): boolean {
  if (!intervals || intervals.length === 0 || !Number.isSafeInteger(target) || target <= 0) {
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
 * Inserts a positive safe integer into a list of sorted, disjoint intervals,
 * merging adjacent or overlapping bounds.
 * Time complexity: O(K) where K = intervals.length.
 */
export function addNumberToIntervals(intervals: IntegerInterval[] | undefined, target: number): IntegerInterval[] {
  if (!Number.isSafeInteger(target) || target <= 0) {
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

/**
 * Inserts multiple integers into intervals efficiently.
 */
export function addNumbersToIntervals(intervals: IntegerInterval[] | undefined, targets: number[]): IntegerInterval[] {
  let current = intervals ? [...intervals] : [];
  for (const t of targets) {
    current = addNumberToIntervals(current, t);
  }
  return current;
}
