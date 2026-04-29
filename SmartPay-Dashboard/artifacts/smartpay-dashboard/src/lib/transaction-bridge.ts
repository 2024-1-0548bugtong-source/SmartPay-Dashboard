import type { TransactionRow } from "./storage";

export interface RawTransactionEvent {
  id: string;
  timestamp: string;
  event: string | null;
  product: string | null;
  paymentStatus: string | null;
  weight: string | null;
  rawLine: string | null;
}

export interface TransactionDraft {
  product: string;
  price: number;
  inserted: number;
  weight: number;
  failureReason: "INSUFFICIENT" | "INVALID" | null;
  pendingCoinValue: number | null;
}

const PIR_DEDUPE_WINDOW_MS = 4000;

function parsePrice(product: string | null): number | null {
  const match = product?.match(/PHP(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

function parseWeight(weight: string | null): number {
  if (!weight) return 0;
  const parsed = parseFloat(weight);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseInsertedAmount(rawLine: string | null, product: string | null): number | null {
  const insertedMatch = rawLine?.match(/inserted:\s*php(\d+)/i);
  if (insertedMatch) {
    return parseInt(insertedMatch[1], 10);
  }

  const contractInsertMatch = rawLine?.match(/coin\s*:\s*(5|10)\s*pesos/i);
  if (contractInsertMatch) {
    return parseInt(contractInsertMatch[1], 10);
  }

  return parsePrice(product);
}

function buildTransactionId(row: Omit<TransactionRow, "id" | "rawLine">): string {
  return [
    row.timestamp,
    row.product,
    row.price,
    row.inserted,
    row.status,
    row.reason,
  ].join(":");
}

function finalizeDraft(
  draft: TransactionDraft,
  timestamp: string,
  status: "SUCCESS" | "FAILED",
  reason: "VALID" | "INSUFFICIENT" | "INVALID"
): TransactionRow {
  const rowWithoutId = {
    timestamp,
    product: draft.product,
    price: draft.price,
    inserted: draft.inserted,
    weight: Number(draft.weight.toFixed(2)),
    status,
    reason,
  };

  return {
    id: buildTransactionId(rowWithoutId),
    ...rowWithoutId,
    rawLine: null,
  };
}

export function applyRawEventToTransaction(
  draft: TransactionDraft | null,
  row: Pick<RawTransactionEvent, "timestamp" | "event" | "product" | "paymentStatus" | "weight" | "rawLine">
): { draft: TransactionDraft | null; completed: TransactionRow | null } {
  const evLower = row.event?.toLowerCase();
  if (!evLower) {
    return { draft, completed: null };
  }

  let nextDraft = draft;

  if (evLower.includes("product removed") && row.product) {
    const price = parsePrice(row.product);
    if (price !== null) {
      nextDraft = {
        product: row.product,
        price,
        inserted: 0,
        weight: 0,
        failureReason: null,
        pendingCoinValue: null,
      };
    }
    return { draft: nextDraft, completed: null };
  }

  if (evLower.startsWith("pay ") && row.product && !nextDraft) {
    const price = parsePrice(row.product);
    if (price !== null) {
      nextDraft = {
        product: row.product,
        price,
        inserted: 0,
        weight: 0,
        failureReason: null,
        pendingCoinValue: null,
      };
    }
    return { draft: nextDraft, completed: null };
  }

  if (!nextDraft) {
    return { draft: null, completed: null };
  }

  if (evLower === "coin detected" && row.product) {
    const coinValue = parsePrice(row.product);
    if (coinValue !== null) {
      nextDraft = {
        ...nextDraft,
        inserted: nextDraft.pendingCoinValue === coinValue ? nextDraft.inserted : nextDraft.inserted + coinValue,
        weight: nextDraft.weight + parseWeight(row.weight),
        pendingCoinValue: nextDraft.pendingCoinValue === coinValue ? null : coinValue,
      };
    }
    return { draft: nextDraft, completed: null };
  }

  if (evLower === "inserted balance") {
    const insertedAmount = parseInsertedAmount(row.rawLine, row.product);
    if (insertedAmount !== null) {
      const isDuplicateOfDetectedCoin = nextDraft.pendingCoinValue === insertedAmount;
      nextDraft = {
        ...nextDraft,
        inserted: isDuplicateOfDetectedCoin ? nextDraft.inserted : nextDraft.inserted + insertedAmount,
        pendingCoinValue: isDuplicateOfDetectedCoin ? null : insertedAmount,
      };
    }
    return { draft: nextDraft, completed: null };
  }

  if (evLower === "invalid coin") {
    const paymentStatus = row.paymentStatus?.toLowerCase();
    const failureReason =
      paymentStatus === "no coin detected" || /payment invalid|invalid coin/i.test(row.rawLine ?? "")
        ? "INVALID"
        : "INSUFFICIENT";
    const isTerminalInvalid =
      paymentStatus === "no coin detected" ||
      paymentStatus === "insufficient" ||
      /payment invalid|payment incomplete|add more coins/i.test(row.rawLine ?? "");

    if (isTerminalInvalid) {
      return {
        draft: null,
        completed: finalizeDraft(nextDraft, row.timestamp, "FAILED", failureReason),
      };
    }

    return {
      draft: { ...nextDraft, failureReason, pendingCoinValue: null },
      completed: null,
    };
  }

  if (evLower === "payment incomplete" || evLower === "add more coins") {
    return {
      draft: {
        ...nextDraft,
        failureReason: nextDraft.failureReason ?? "INSUFFICIENT",
        pendingCoinValue: null,
      },
      completed: null,
    };
  }

  if (evLower === "payment ok") {
    return {
      draft: null,
      completed: finalizeDraft(nextDraft, row.timestamp, "SUCCESS", "VALID"),
    };
  }

  if (evLower === "customer left" || evLower === "honestpay ready") {
    const reason = nextDraft.failureReason ?? (nextDraft.inserted < nextDraft.price ? "INSUFFICIENT" : "INVALID");
    return {
      draft: null,
      completed: finalizeDraft(nextDraft, row.timestamp, "FAILED", reason),
    };
  }

  return { draft: nextDraft, completed: null };
}

export function buildCompletedTransactionsFromEvents(rows: RawTransactionEvent[]): TransactionRow[] {
  let draft: TransactionDraft | null = null;
  const completed: TransactionRow[] = [];

  const sorted = rows
    .slice()
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  for (const row of sorted) {
    const next = applyRawEventToTransaction(draft, row);
    draft = next.draft;
    if (next.completed) {
      completed.push(next.completed);
    }
  }

  return completed.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export function mergeCompletedTransactions(
  existing: TransactionRow[],
  incoming: TransactionRow[]
): TransactionRow[] {
  const merged = new Map<string, TransactionRow>();

  for (const row of [...existing, ...incoming]) {
    merged.set(buildTransactionId(row), { ...row, id: buildTransactionId(row) });
  }

  return Array.from(merged.values()).sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

export function countPirEntries(rows: RawTransactionEvent[]): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const entryRows = rows
    .filter((row) => row.event?.toLowerCase() === "entry" && new Date(row.timestamp) >= today)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  let count = 0;
  let lastCountedAt = 0;

  for (const row of entryRows) {
    const ts = new Date(row.timestamp).getTime();
    if (!Number.isFinite(ts)) continue;
    if (ts - lastCountedAt >= PIR_DEDUPE_WINDOW_MS) {
      count += 1;
      lastCountedAt = ts;
    }
  }

  return count;
}
