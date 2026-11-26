# Sprint 5.0D — Performance & Storage Benchmark Report

## 1. Methodology & Test Environment

- **Benchmark Harness:** `scripts/benchmark-archive-compaction.ts`
- **Execution Date:** 2026-11-22
- **Environment:** Windows 11 x64, Node.js v22 (with `--experimental-strip-types`)
- **Synthetic Test Scales:** 1,000, 5,000, 10,000, 25,000, and 50,000 records
- **Target Active Window Threshold:** 5,000 records
- **Isolation:** Each test scale was executed in an isolated temporary directory created via `fs.mkdtemp` and cleaned up upon completion.

---

## 2. Empirical Performance Metrics

| Record Scale | Archived Records | Inspect (ms) | Dry-Run (ms) | Compaction (ms) | Verification (ms) | Active Ledger Size | Archive File Size | Total Size | Audit Result |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **1,000** | 0 | 9.4 ms | 2.0 ms | 2.1 ms | 2.0 ms | 291.6 KB | 0.0 KB | 291.6 KB | **PASS** |
| **5,000** | 0 | 12.7 ms | 5.4 ms | 5.1 ms | 5.9 ms | 1,463.8 KB | 0.0 KB | 1,463.8 KB | **PASS** |
| **10,000** | 5,000 | 18.5 ms | 28.1 ms | 50.1 ms | 29.1 ms | 1,465.8 KB | 1,511.0 KB | 2,976.8 KB | **PASS** |
| **25,000** | 20,000 | 29.8 ms | 97.2 ms | 127.9 ms | 88.4 ms | 1,474.6 KB | 6,065.2 KB | 7,539.8 KB | **PASS** |
| **50,000** | 45,000 | 60.7 ms | 177.0 ms | 246.1 ms | 193.3 ms | 1,474.6 KB | 13,670.2 KB | 15,144.8 KB | **PASS** |

---

## 3. Analysis & Key Takeaways

1. **Active Ledger Working Set Clamping:**
   - At 1,000 records, `activity.json` is ~291 KB.
   - At 5,000 records, `activity.json` is ~1.46 MB.
   - For all scales beyond 5,000 records (10,000, 25,000, and 50,000 records), the active ledger size is **strictly bounded at ~1.47 MB**, preventing unbounded memory footprint and Git repository bloat in the primary working tree.

2. **Compaction Throughput:**
   - Compacting 45,000 records (moving from 50k to 5k active) took **246.1 ms** total execution time.
   - Throughput: over **180,000 records/sec** evaluated and partitioned.

3. **Verification Speed:**
   - Full SHA-256 canonical digest verification and cross-ledger deduplication check for 50,000 records completed in **193.3 ms**.

4. **Storage Overhead Honesty:**
   - Archived records in `activity_archive.json` require slightly more storage than raw active records (~1,511 KB for 5,000 archived records vs ~1,463 KB active) due to explicit batch manifest metadata (`batchId`, `createdAt`, `recordRange`, `sha256`) and formatted JSON indentation.
   - This small overhead (~3%) is an intentional engineering trade-off that provides complete human auditability, tamper detection, and deterministic recovery.
