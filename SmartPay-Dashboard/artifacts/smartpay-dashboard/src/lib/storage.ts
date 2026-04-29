import { formatProductLabel } from "./serial";
import type { LcdState } from "./serial";

/**
 * ONE transaction per completed payment attempt (consolidated from multiple serial events).
 * - status: "SUCCESS" if inserted === price, "FAILED" otherwise
 * - reason: "VALID" (success), "INSUFFICIENT" (underpaid), "INVALID" (overpaid/wrong coin)
 */
export interface TransactionRow {
  id: string;
  timestamp: string;
  event?: string | null;
  product: string; // "Product One (PHP5)" or "Product Two (PHP10)"
  price: number;   // PHP amount required
  inserted: number; // total PHP inserted (sum of all coins)
  weight: number;  // total weight of coins inserted
  status: "SUCCESS" | "FAILED"; // final outcome
  reason: "VALID" | "INSUFFICIENT" | "INVALID"; // reason for status
  rawLine: string | null; // original serial line for debugging
}

export interface PirCounter {
  count: number;
  date: string; // YYYY-MM-DD, reset daily
}

interface PersistedTransactionsEnvelope {
  version: number;
  clearedAt: number;
  rows: TransactionRow[];
}

const STORAGE_KEY = "smartpay_transactions_v2";
const LEGACY_STORAGE_KEY = "smartpay_transactions";
const DARK_MODE_KEY = "smartpay_dark_mode";
const PIR_KEY = "smartpay_pir_counter";
const CLEARED_AT_KEY = "smartpay_cleared_at";
const STORAGE_VERSION = 2;

function parseTimestampMs(timestamp: string | null | undefined): number {
  if (!timestamp) return 0;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeTransactionRows(rows: TransactionRow[], clearedAt = 0): TransactionRow[] {
  return rows
    .filter((row): row is TransactionRow => Boolean(row && typeof row.timestamp === "string"))
    .map((row) => ({
      ...row,
      product: formatProductLabel(row.product) ?? row.product,
    }))
    .filter((row) => {
      const timestampMs = parseTimestampMs(row.timestamp);
      return clearedAt === 0 || timestampMs === 0 || timestampMs >= clearedAt;
    })
    .slice(0, 1000);
}

function isPersistedTransactionsEnvelope(value: unknown): value is PersistedTransactionsEnvelope {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<PersistedTransactionsEnvelope>;
  return (
    candidate.version === STORAGE_VERSION &&
    typeof candidate.clearedAt === "number" &&
    Array.isArray(candidate.rows)
  );
}

// ── Transactions ──────────────────────────────────────────────────────────

export function loadTransactions(clearedAt = loadClearedAt()): TransactionRow[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;

      if (isPersistedTransactionsEnvelope(parsed)) {
        return normalizeTransactionRows(parsed.rows, Math.max(clearedAt, parsed.clearedAt));
      }
    }

    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacyRaw) return [];

    const legacyParsed = JSON.parse(legacyRaw) as unknown;

    // Only accept legacy storage when it already matches the current
    // envelope schema. Plain array payloads are ignored so older bundles
    // cannot resurrect stale rows into the current reducer state.
    if (isPersistedTransactionsEnvelope(legacyParsed)) {
      const normalizedRows = normalizeTransactionRows(legacyParsed.rows, Math.max(clearedAt, legacyParsed.clearedAt));
      saveTransactions(normalizedRows, Math.max(clearedAt, legacyParsed.clearedAt));
      try {
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      } catch {}
      return normalizedRows;
    }

    return [];
  } catch {
    return [];
  }
}

export function saveTransactions(rows: TransactionRow[], clearedAt = loadClearedAt()): void {
  try {
    const envelope: PersistedTransactionsEnvelope = {
      version: STORAGE_VERSION,
      clearedAt,
      rows: normalizeTransactionRows(rows, clearedAt),
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // ignore storage quota errors
  }
}

export function clearTransactionsStorage(clearedAt: number): void {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {}
  saveTransactions([], clearedAt);
}

// ── Dark Mode ─────────────────────────────────────────────────────────────

export function loadDarkMode(): boolean {
  try {
    return localStorage.getItem(DARK_MODE_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveDarkMode(dark: boolean): void {
  try {
    localStorage.setItem(DARK_MODE_KEY, String(dark));
  } catch {}
}

// ── PIR Entry Counter (daily reset) ──────────────────────────────────────

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

export function loadPirCounter(): PirCounter {
  try {
    const raw = localStorage.getItem(PIR_KEY);
    if (!raw) return { count: 0, date: todayKey() };
    const parsed = JSON.parse(raw) as PirCounter;
    // Reset if a new day has started
    if (parsed.date !== todayKey()) return { count: 0, date: todayKey() };
    return parsed;
  } catch {
    return { count: 0, date: todayKey() };
  }
}

export function savePirCounter(counter: PirCounter): void {
  try {
    localStorage.setItem(PIR_KEY, JSON.stringify(counter));
  } catch {}
}

export function loadClearedAt(): number {
  try {
    const raw = localStorage.getItem(CLEARED_AT_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : 0;
    if (Number.isFinite(parsed) && parsed > 0) return parsed;

    const currentTransactionsRaw = localStorage.getItem(STORAGE_KEY);
    if (currentTransactionsRaw) {
      const currentTransactionsParsed = JSON.parse(currentTransactionsRaw) as unknown;
      if (isPersistedTransactionsEnvelope(currentTransactionsParsed)) {
        return currentTransactionsParsed.clearedAt;
      }
    }

    const legacyTransactionsRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyTransactionsRaw) {
      const legacyTransactionsParsed = JSON.parse(legacyTransactionsRaw) as unknown;
      if (isPersistedTransactionsEnvelope(legacyTransactionsParsed)) {
        return legacyTransactionsParsed.clearedAt;
      }
    }

    return 0;
  } catch {
    return 0;
  }
}

export function saveClearedAt(clearedAt: number): void {
  try {
    if (clearedAt > 0) {
      localStorage.setItem(CLEARED_AT_KEY, String(clearedAt));
      return;
    }

    localStorage.removeItem(CLEARED_AT_KEY);
  } catch {}
}

export function incrementPirCounter(current: PirCounter): PirCounter {
  const date = todayKey();
  // Reset if new day
  const base = current.date === date ? current.count : 0;
  return { count: base + 1, date };
}

/**
 * Compute today's PIR entry count directly from the transaction log.
 * This ensures the counter stays accurate even after page reload or when
 * historical transactions are loaded from the API.
 */
export function computePirFromTransactions(rows: TransactionRow[]): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const PIR_DEDUPE_WINDOW_MS = 4000;

  const candidates = rows
    .filter((r) => {
      const ev = r.event?.toLowerCase();
      if (!ev) return false;
      const isPirEvent =
        ev === "entry" ||
        ev === "customer entered" ||
        ev === "customer_entered";
      return isPirEvent && new Date(r.timestamp) >= today;
    })
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  let count = 0;
  let lastCountedAt = 0;

  for (const row of candidates) {
    const ts = new Date(row.timestamp).getTime();
    if (!Number.isFinite(ts)) continue;
    if (ts - lastCountedAt >= PIR_DEDUPE_WINDOW_MS) {
      count += 1;
      lastCountedAt = ts;
    }
  }

  return count;
}

// ── CSV Export ────────────────────────────────────────────────────────────

export function exportCsv(rows: TransactionRow[]): void {
  const header = "Timestamp,Product,Price (PHP),Inserted (PHP),Weight (g),Status,Reason\n";
  const body = rows
    .map((r) => {
      const cols = [
        r.timestamp,
        r.product,
        String(r.price),
        String(r.inserted),
        String(r.weight.toFixed(2)),
        r.status,
        r.reason,
      ].map((c) => `"${String(c).replace(/"/g, '""')}"`);
      return cols.join(",");
    })
    .join("\n");
  const csv = header + body;
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `honestpay_export_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Stats ─────────────────────────────────────────────────────────────────

export function computeStats(rows: TransactionRow[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayRows = rows.filter((r) => new Date(r.timestamp) >= today);

  const todayCount = todayRows.length;

  let totalRevenue = 0;
  let successCount = 0;
  let failureCount = 0;

  for (const row of todayRows) {
    if (row.status === "SUCCESS") {
      successCount++;
      totalRevenue += row.price;
    } else if (row.status === "FAILED") {
      failureCount++;
    }
  }

  const totalAttempts = successCount + failureCount;
  const successRate =
    totalAttempts > 0 ? Math.round((successCount / totalAttempts) * 100) : null;

  // Hourly breakdown: count one transaction per hour it occurred
  const currentHour = new Date().getHours();
  const hourlyCounts: Record<string, number> = {};
  for (let h = Math.max(0, currentHour - 11); h <= currentHour; h++) {
    hourlyCounts[`${String(h).padStart(2, "0")}:00`] = 0;
  }
  for (const row of todayRows) {
    const h = new Date(row.timestamp).getHours();
    const label = `${String(h).padStart(2, "0")}:00`;
    if (label in hourlyCounts) hourlyCounts[label]++;
  }
  const hourlyData = Object.entries(hourlyCounts).map(([hour, count]) => ({
    hour,
    count,
  }));

  // Current state: "Ready" if no transactions or last was successful, "Customer Present" if last failed
  let currentState = "Ready";
  if (todayRows.length > 0) {
    const last = todayRows[todayRows.length - 1];
    currentState = last.status === "FAILED" ? "Payment Failed" : "Ready";
  }

  return {
    todayCount,
    totalRevenue,
    successRate,
    successCount,
    failureCount,
    totalAttempts,
    currentState,
    hourlyData,
  };
}

// ── Transaction Consolidation ─────────────────────────────────────────

/**
 * Runtime state to build up a transaction from multiple serial events.
 * When payment completes (Payment OK or Add More Coins), finalize into TransactionRow.
 */
export interface OngoingTransaction {
  product: string | null;
  price: number | null;
  insertedCoins: number;
  totalWeight: number;
  startTime: number;
}

/**
 * Finalize an ongoing transaction into a completed TransactionRow.
 * Returns null if transaction data is incomplete.
 */
export function finalizeTransaction(
  ongoing: OngoingTransaction | null,
  timestamp: string
): TransactionRow | null {
  if (!ongoing || !ongoing.product || ongoing.price === null) return null;

  const status: "SUCCESS" | "FAILED" = 
    ongoing.insertedCoins === ongoing.price ? "SUCCESS" : "FAILED";
  
  let reason: "VALID" | "INSUFFICIENT" | "INVALID";
  if (status === "SUCCESS") {
    reason = "VALID";
  } else if (ongoing.insertedCoins < ongoing.price) {
    reason = "INSUFFICIENT";
  } else {
    reason = "INVALID";
  }

  return {
    id: `tx-${Date.now()}-${Math.random()}`,
    timestamp,
    product: ongoing.product,
    price: ongoing.price,
    inserted: ongoing.insertedCoins,
    weight: ongoing.totalWeight,
    status,
    reason,
    rawLine: null,
  };
}
