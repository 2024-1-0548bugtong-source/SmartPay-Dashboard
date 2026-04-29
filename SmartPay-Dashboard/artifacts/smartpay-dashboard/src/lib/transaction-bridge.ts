import { formatProductLabel, unwrapRawSerialLine } from "./serial";
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
  attemptedCoinValue: number | null;
  pendingCoinValue: number | null;
  startedAtMs: number;
  lastActivityAtMs: number;
}

const PIR_DEDUPE_WINDOW_MS = 4000;
export const PAYMENT_GRACE_MS = 30_000;

function createDraft(product: string, price: number, eventTimestampMs: number): TransactionDraft {
  return {
    product,
    price,
    inserted: 0,
    weight: 0,
    failureReason: null,
    attemptedCoinValue: null,
    pendingCoinValue: null,
    startedAtMs: eventTimestampMs,
    lastActivityAtMs: eventTimestampMs,
  };
}

function parseTimestampMs(timestamp: string): number {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function parsePrice(product: string | null): number | null {
  const match = product?.match(/PHP(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

function normalizeProductLabel(product: string | null): string | null {
  return formatProductLabel(product) ?? product;
}

function parseWeight(weight: string | null): number {
  if (!weight) return 0;
  const parsed = parseFloat(weight);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseInsertedSignal(
  rawLine: string | null,
  product: string | null
): { amount: number; mode: "absolute" | "increment" } | null {
  const normalizedRawLine = unwrapRawSerialLine(rawLine);

  const insertedMatch = normalizedRawLine?.match(/inserted:\s*php(\d+)/i);
  if (insertedMatch) {
    return { amount: parseInt(insertedMatch[1], 10), mode: "absolute" };
  }

  const contractInsertMatch = normalizedRawLine?.match(/coin\s*:\s*(5|10)\s*pesos/i);
  if (contractInsertMatch) {
    return { amount: parseInt(contractInsertMatch[1], 10), mode: "increment" };
  }

  const telemetryCoinValueMatch = normalizedRawLine?.match(/coin\s+value:\s*(5|10)\b/i);
  if (telemetryCoinValueMatch) {
    return { amount: parseInt(telemetryCoinValueMatch[1], 10), mode: "increment" };
  }

  const parsedPrice = parsePrice(product);
  return parsedPrice === null ? null : { amount: parsedPrice, mode: "increment" };
}

function timestampKey(timestamp: string): string {
  const parsed = parseTimestampMs(timestamp);
  if (!Number.isFinite(parsed)) return timestamp;
  return new Date(Math.floor(parsed / 1000) * 1000).toISOString();
}

function buildTransactionId(row: Omit<TransactionRow, "id" | "rawLine">): string {
  return [
    timestampKey(row.timestamp),
    normalizeProductLabel(row.product),
    row.price,
    row.inserted,
    row.status,
    row.reason,
  ].join(":");
}

function buildTransactionMergeKey(row: Omit<TransactionRow, "id">): string {
  return [
    timestampKey(row.timestamp),
    normalizeProductLabel(row.product),
    row.price,
    row.status,
    row.reason,
  ].join(":");
}

function pickRicherTransactionRow(current: TransactionRow, candidate: TransactionRow): TransactionRow {
  if (candidate.inserted !== current.inserted) {
    return candidate.inserted > current.inserted ? candidate : current;
  }

  if (candidate.weight !== current.weight) {
    return candidate.weight > current.weight ? candidate : current;
  }

  if ((candidate.rawLine ?? "").length !== (current.rawLine ?? "").length) {
    return (candidate.rawLine ?? "").length > (current.rawLine ?? "").length ? candidate : current;
  }

  return candidate;
}

function finalizeDraft(
  draft: TransactionDraft,
  timestamp: string,
  status: "SUCCESS" | "FAILED",
  reason: "VALID" | "INSUFFICIENT" | "INVALID"
): TransactionRow {
  const product = normalizeProductLabel(draft.product) ?? draft.product;
  const inserted = status === "SUCCESS" ? Math.max(draft.inserted, draft.price) : draft.inserted;
  const rowWithoutId = {
    timestamp,
    product,
    price: draft.price,
    inserted,
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

function deriveFailedReason(draft: TransactionDraft): "INSUFFICIENT" | "INVALID" {
  // Failure classification is based on the last attempted coin first.
  const decisionAmount = draft.attemptedCoinValue ?? draft.inserted;

  if (decisionAmount > draft.price) return "INVALID";
  if (decisionAmount < draft.price) return "INSUFFICIENT";

  if (draft.failureReason) return draft.failureReason;
  return draft.inserted > draft.price ? "INVALID" : "INSUFFICIENT";
}

function upsertDraftFromPrompt(
  draft: TransactionDraft | null,
  product: string,
  price: number,
  eventTimestampMs: number
): TransactionDraft {
  const normalizedProduct = normalizeProductLabel(product) ?? product;

  if (!draft) {
    return createDraft(normalizedProduct, price, eventTimestampMs);
  }

  const sameProduct = normalizeProductLabel(draft.product) === normalizedProduct;
  if (sameProduct) {
    return {
      ...draft,
      lastActivityAtMs: eventTimestampMs,
    };
  }

  // A new product prompt takes ownership of the active checkout. Keeping the
  // previous draft causes the next terminal line to be attributed to the wrong product.
  return createDraft(normalizedProduct, price, eventTimestampMs);
}

export function applyRawEventToTransaction(
  draft: TransactionDraft | null,
  row: Pick<RawTransactionEvent, "timestamp" | "event" | "product" | "paymentStatus" | "weight" | "rawLine">
): { draft: TransactionDraft | null; completed: TransactionRow | null } {
  const evLower = row.event?.toLowerCase();
  const eventTimestampMs = parseTimestampMs(row.timestamp);
  if (!evLower) {
    return { draft, completed: null };
  }

  let nextDraft = draft;

  if (evLower.includes("product removed") && row.product) {
    const product = normalizeProductLabel(row.product);
    const price = parsePrice(product);
    if (price !== null) {
      const previousFailedDraft = draft?.failureReason ? draft : null;
      nextDraft = upsertDraftFromPrompt(draft, product ?? row.product, price, eventTimestampMs);
      if (previousFailedDraft) {
        return {
          draft: nextDraft,
          completed: finalizeDraft(previousFailedDraft, row.timestamp, "FAILED", deriveFailedReason(previousFailedDraft)),
        };
      }
    }
    return { draft: nextDraft, completed: null };
  }

  if (evLower.startsWith("pay ") && row.product) {
    const product = normalizeProductLabel(row.product);
    const price = parsePrice(product);
    if (price !== null) {
      const previousFailedDraft = draft?.failureReason ? draft : null;
      nextDraft = upsertDraftFromPrompt(draft, product ?? row.product, price, eventTimestampMs);
      if (previousFailedDraft) {
        return {
          draft: nextDraft,
          completed: finalizeDraft(previousFailedDraft, row.timestamp, "FAILED", deriveFailedReason(previousFailedDraft)),
        };
      }
    }
    return { draft: nextDraft, completed: null };
  }

  if (!nextDraft) {
    return { draft: null, completed: null };
  }

  if (evLower === "coin detected" && row.product) {
    const normalizedProduct = normalizeProductLabel(row.product);
    const coinValue = parsePrice(normalizedProduct);
    if (coinValue !== null) {
      nextDraft = {
        ...nextDraft,
        inserted: nextDraft.pendingCoinValue === coinValue ? nextDraft.inserted : nextDraft.inserted + coinValue,
        weight: nextDraft.weight + parseWeight(row.weight),
        attemptedCoinValue: coinValue,
        pendingCoinValue: nextDraft.pendingCoinValue === coinValue ? null : coinValue,
        lastActivityAtMs: eventTimestampMs,
      };
    }
    return { draft: nextDraft, completed: null };
  }

  if (evLower === "inserted balance") {
    const insertedSignal = parseInsertedSignal(row.rawLine, row.product);
    if (insertedSignal !== null) {
      const isDuplicateOfDetectedCoin =
        insertedSignal.mode === "increment" && nextDraft.pendingCoinValue === insertedSignal.amount;

      nextDraft = {
        ...nextDraft,
        inserted:
          insertedSignal.mode === "absolute"
            ? Math.max(nextDraft.inserted, insertedSignal.amount)
            : isDuplicateOfDetectedCoin
              ? nextDraft.inserted
              : nextDraft.inserted + insertedSignal.amount,
        attemptedCoinValue: insertedSignal.amount,
        pendingCoinValue:
          insertedSignal.mode === "absolute"
            ? null
            : isDuplicateOfDetectedCoin
              ? null
              : insertedSignal.amount,
        lastActivityAtMs: eventTimestampMs,
      };
    }
    return { draft: nextDraft, completed: null };
  }

  if (evLower === "invalid coin") {
    const failureReason = deriveFailedReason(nextDraft);
    return {
      draft: { ...nextDraft, failureReason, pendingCoinValue: null, lastActivityAtMs: eventTimestampMs },
      completed: null,
    };
  }

  if (evLower === "payment incomplete" || evLower === "add more coins") {
    return {
      draft: {
        ...nextDraft,
        failureReason: deriveFailedReason(nextDraft),
        pendingCoinValue: null,
        lastActivityAtMs: eventTimestampMs,
      },
      completed: null,
    };
  }

  if (evLower === "payment ok" || evLower === "dispensing product") {
    return {
      draft: null,
      completed: finalizeDraft(nextDraft, row.timestamp, "SUCCESS", "VALID"),
    };
  }

  if (evLower === "customer left" || evLower === "honestpay ready") {
    if (nextDraft.failureReason) {
      return {
        draft: null,
        completed: finalizeDraft(nextDraft, row.timestamp, "FAILED", deriveFailedReason(nextDraft)),
      };
    }

    if (eventTimestampMs - nextDraft.lastActivityAtMs < PAYMENT_GRACE_MS) {
      return { draft: nextDraft, completed: null };
    }

    const reason = deriveFailedReason(nextDraft);
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
    const mergeKey = buildTransactionMergeKey(row);
    const current = merged.get(mergeKey);
    const next = current ? pickRicherTransactionRow(current, row) : row;
    merged.set(mergeKey, { ...next, id: buildTransactionId(next) });
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
