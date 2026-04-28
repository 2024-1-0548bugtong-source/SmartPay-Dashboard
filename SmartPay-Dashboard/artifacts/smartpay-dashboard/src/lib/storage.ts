import type { LcdState } from "./serial";

export interface TransactionRow {
  id: string;
  timestamp: string;
  event: string;
  product: string | null;
  paymentStatus: string | null;
  weight: string | null;
  rawLine: string | null;
}

export interface PirCounter {
  count: number;
  date: string; // YYYY-MM-DD, reset daily
}

const STORAGE_KEY = "smartpay_transactions";
const DARK_MODE_KEY = "smartpay_dark_mode";
const PIR_KEY = "smartpay_pir_counter";

// ── Transactions ──────────────────────────────────────────────────────────

export function loadTransactions(): TransactionRow[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as TransactionRow[];
  } catch {
    return [];
  }
}

export function saveTransactions(rows: TransactionRow[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows.slice(0, 1000)));
  } catch {
    // ignore storage quota errors
  }
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
      const ev = r.event.toLowerCase();
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
  const header = "Timestamp,Event,Product,Payment Status,Weight,Raw Line\n";
  const body = rows
    .map((r) => {
      const cols = [
        r.timestamp,
        r.event,
        r.product ?? "",
        r.paymentStatus ?? "",
        r.weight ?? "",
        r.rawLine ?? "",
      ].map((c) => `"${String(c).replace(/"/g, '""')}"`);
      return cols.join(",");
    })
    .join("\n");
  const csv = header + body;
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `smartpay_export_${new Date().toISOString().slice(0, 10)}.csv`;
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
  let verifiedCount = 0;
  let insufficientCount = 0;
  let currentState = "Ready";

  // Track timing for avg transaction time
  const completedTimes: number[] = [];
  let entryTime: number | null = null;

  const sorted = [...todayRows].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Carry the last known product price across rows so "Payment OK" (which has no product)
  // can still count revenue against the preceding "Product Removed" row.
  let lastKnownProduct: string | null = null;

  for (const row of sorted) {
    const ev = row.event.toLowerCase();
    const paymentStatus = (row.paymentStatus ?? "").toLowerCase();
    const ts = new Date(row.timestamp).getTime();

    // Remember the product price from "Product Removed" / pay-prompt rows
    if (row.product) lastKnownProduct = row.product;

    // Reset product tracking when a new customer session starts
    if (ev === "entry" || ev === "smartpay ready" || ev === "customer left") {
      if (ev === "entry") entryTime = ts;
      if (ev !== "entry") lastKnownProduct = null;
    }

    if ((ev === "payment ok" || ev === "customer left") && entryTime !== null) {
      completedTimes.push((ts - entryTime) / 1000);
      entryTime = null;
    }

    // Only count explicit payment outcome events for success metrics.
    if (ev === "payment ok" || paymentStatus === "verified") {
      // Use product from this row OR the last seen product from the same session
      const productStr = row.product ?? lastKnownProduct;
      const match = productStr?.match(/PHP(\d+)/i);
      if (match) totalRevenue += parseInt(match[1], 10);
      verifiedCount++;
      lastKnownProduct = null; // consumed
    } else if (
      ev === "payment incomplete" ||
      ev === "add more coins" ||
      ev.includes("invalid coin") ||
      paymentStatus === "insufficient"
    ) {
      insufficientCount++;
      // Don't clear lastKnownProduct — next attempt (if any) is for same product
    }
  }

  // Success rate = verified / (verified + insufficient coin attempts)
  const totalPaymentAttempts = verifiedCount + insufficientCount;
  const successRate =
    totalPaymentAttempts > 0
      ? Math.round((verifiedCount / totalPaymentAttempts) * 100)
      : null; // null = no data yet

  const avgTime =
    completedTimes.length > 0
      ? Math.round(completedTimes.reduce((a, b) => a + b, 0) / completedTimes.length)
      : null;

  const latestRow = sorted[sorted.length - 1];
  if (latestRow) {
    const ev = latestRow.event.toLowerCase();
    if (
      ev === "entry" ||
      ev.includes("product removed") ||
      ev.includes("payment") ||
      ev.includes("customer entered") ||
      ev.startsWith("pay ") ||
      ev.includes("coin detected") ||
      ev.includes("inserted balance") ||
      ev.includes("remaining balance") ||
      ev.includes("dispensing product") ||
      ev.includes("add more")
    ) {
      currentState = "Customer Present";
    } else if (ev === "customer left" || ev === "smartpay ready") {
      currentState = "Ready";
    }
  }

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
  const hourlyData = Object.entries(hourlyCounts).map(([hour, count]) => ({ hour, count }));

  return {
    todayCount,
    totalRevenue,
    successRate,           // number (0–100) or null when no payment attempts yet
    verifiedCount,
    insufficientCount,
    totalPaymentAttempts,
    currentState,
    hourlyData,
    avgTime,
  };
}
