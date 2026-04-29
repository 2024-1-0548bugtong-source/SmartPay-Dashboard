const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");

const REQUESTED_SERIAL_PORT = process.argv[2] || process.env.SERIAL_PORT || "auto";
const BAUD_RATE = Number(process.env.BAUD_RATE || 9600);
const VERCEL_BASE_URL = (process.env.VERCEL_BASE_URL || process.argv[3] || "https://honest-pay-dashboard.vercel.app").replace(/\/$/, "");
const API_URL = `${VERCEL_BASE_URL}/api/transactions`;
const DEDUPE_WINDOW_MS = Number(process.env.DEDUPE_WINDOW_MS || 2500);
const PAYMENT_GRACE_MS = Number(process.env.PAYMENT_GRACE_MS || 30000);
const ALLOW_EVENT_POSTS = process.env.ALLOW_EVENT_POSTS === "true";

/** @typedef {"P1" | "P2"} ProductCode */
/** @typedef {"SUCCESS" | "FAILED"} TransactionStatus */
/** @typedef {"VALID" | "INVALID" | "INSUFFICIENT"} TransactionReason */

/**
 * @typedef {{
 *   product: ProductCode,
 *   price: number,
 *   inserted: number,
 *   weight: number,
 *   failureReason: Exclude<TransactionReason, "VALID"> | null,
 *   attemptedCoinValue: number | null,
 *   pendingCoinValue: number | null,
 *   startedAtMs: number,
 *   lastActivityAtMs: number,
 * }} OngoingTransaction
 */

/**
 * @typedef {{
 *   timestamp: string,
 *   product: ProductCode,
 *   price: number,
 *   inserted: number,
 *   weight: number | null,
 *   status: TransactionStatus,
 *   reason: TransactionReason,
 *   rawLine: string,
 * }} TransactionPayload
 */

/**
 * @typedef {{
 *   kind: "transaction",
 *   status: TransactionStatus,
 *   product: ProductCode | null,
 *   price: number | null,
 *   inserted: number,
 *   weight: number | null,
 *   reason: TransactionReason,
 *   rawLine: string,
 * }} ParsedTransactionLine
 */

/**
 * @typedef {{
 *   kind: "event",
 *   event: string,
 *   product: string | null,
 *   paymentStatus: string | null,
 *   weight: string | null,
 *   rawLine: string,
 * }} ParsedEventLine
 */

/** @typedef {ParsedTransactionLine | ParsedEventLine} ParsedLine */

let lastSentAt = 0;
let lastPirSentAt = 0;
/** @type {number | null} */
let lastKnownInserted = null;
/** @type {OngoingTransaction | null} */
let ongoingTransaction = null;

const verboseTelemetryRuntime = {
  lastCoinValue: 0,
  lastProductType: 0,
};

/** @param {unknown} value */
function normalizeEvent(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

/** @param {unknown} value */
function unwrapRawLine(value) {
  if (typeof value !== "string") return "";

  let raw = value.trim();
  if (!raw) return "";

  for (let depth = 0; depth < 3; depth += 1) {
    if (!raw.startsWith("{")) break;

    try {
      const parsed = JSON.parse(raw);
      const nestedRaw = typeof parsed?.rawLine === "string" ? parsed.rawLine.trim() : "";
      if (!nestedRaw || nestedRaw === raw) break;
      raw = nestedRaw;
    } catch {
      break;
    }
  }

  return raw;
}

/** @param {unknown} token */
function formatProductLabel(token) {
  const value = String(token || "").trim();
  if (!value) return null;

  const compact = value.toUpperCase().replace(/\s+/g, "");
  const priceMatch = value.match(/(?:PHP\s*(10|5)|(10|5)\s*PHP)/i);
  const priceDigit = priceMatch?.[1] ?? priceMatch?.[2] ?? null;

  if (priceDigit === "5" || compact.includes("PRODUCTONE") || compact.includes("PRODUCT1") || compact === "P1") {
    return "Product One (PHP5)";
  }

  if (priceDigit === "10" || compact.includes("PRODUCTTWO") || compact.includes("PRODUCT2") || compact === "P2") {
    return "Product Two (PHP10)";
  }

  return value;
}

/** @param {unknown} rawProduct
 *  @returns {ProductCode | null}
 */
function formatTransactionProduct(rawProduct) {
  const value = String(rawProduct || "").trim();
  if (!value) return null;

  if (/^p1$/i.test(value)) return "P1";
  if (/^p2$/i.test(value)) return "P2";

  const compact = value.toUpperCase().replace(/\s+/g, "");
  if (compact.includes("PRODUCTONE") || compact.includes("PHP5") || compact === "1") return "P1";
  if (compact.includes("PRODUCTTWO") || compact.includes("PHP10") || compact === "2") return "P2";

  return null;
}

/** @param {unknown} rawProduct */
function inferPriceFromProduct(rawProduct) {
  const product = formatTransactionProduct(rawProduct) || String(rawProduct || "").trim().toUpperCase();
  if (product === "P1" || product.includes("PHP5") || product.includes("PRODUCT ONE")) return 5;
  if (product === "P2" || product.includes("PHP10") || product.includes("PRODUCT TWO")) return 10;
  return null;
}

/** @param {unknown} rawWeight */
function parseWeightValue(rawWeight) {
  if (typeof rawWeight === "number") return Number.isFinite(rawWeight) ? rawWeight : 0;
  if (typeof rawWeight !== "string") return 0;
  const parsed = Number.parseFloat(rawWeight.replace(/g$/i, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * @param {string} rawLine
 * @param {string | null} product
 * @returns {number | null}
 */
function parseInsertedAmount(rawLine, product) {
  const normalizedRaw = unwrapRawLine(rawLine);

  const insertedMatch = normalizedRaw.match(/inserted:\s*php(\d+)/i);
  if (insertedMatch) {
    return Number.parseInt(insertedMatch[1], 10);
  }

  const contractInsertMatch = normalizedRaw.match(/coin\s*:\s*(5|10)\s*pesos/i);
  if (contractInsertMatch) {
    return Number.parseInt(contractInsertMatch[1], 10);
  }

  const telemetryCoinValueMatch = normalizedRaw.match(/coin\s+value:\s*(5|10)\b/i);
  if (telemetryCoinValueMatch) {
    return Number.parseInt(telemetryCoinValueMatch[1], 10);
  }

  return inferPriceFromProduct(product);
}

/**
 * Parse only explicit inserted values from a raw line. Returns `null`
 * when no explicit inserted amount is present (do not fallback to inferred price).
 * @param {string} rawLine
 * @returns {number | null}
 */
function parseInsertedExplicit(rawLine) {
  const normalizedRaw = unwrapRawLine(rawLine);
  if (!normalizedRaw) return null;

  const insertedMatch = normalizedRaw.match(/inserted:\s*php(\d+)/i);
  if (insertedMatch) return Number.parseInt(insertedMatch[1], 10);
  const contractInsertMatch = normalizedRaw.match(/coin\s*:\s*(5|10)\s*pesos/i);
  if (contractInsertMatch) return Number.parseInt(contractInsertMatch[1], 10);
  const telemetryCoinValueMatch = normalizedRaw.match(/coin\s+value:\s*(5|10)\b/i);
  if (telemetryCoinValueMatch) return Number.parseInt(telemetryCoinValueMatch[1], 10);
  return null;
}

/** @param {OngoingTransaction} transaction */
function deriveFailedReason(transaction) {
  const decisionAmount = transaction.attemptedCoinValue ?? transaction.inserted;

  if (decisionAmount > transaction.price) return "INVALID";
  if (decisionAmount < transaction.price) return "INSUFFICIENT";

  if (transaction.failureReason) return transaction.failureReason;
  return transaction.inserted > transaction.price ? "INVALID" : "INSUFFICIENT";
}

/**
 * @param {{ status: TransactionStatus, reason: TransactionReason, rawLine: string, timestampMs?: number }} param0
 * @returns {TransactionPayload | null}
 */
function buildTransactionPayload({ status, reason, rawLine, timestampMs }) {
  if (!ongoingTransaction || !ongoingTransaction.product || !Number.isFinite(ongoingTransaction.price)) {
    return null;
  }

  const weight = ongoingTransaction.weight > 0
    ? Number(ongoingTransaction.weight.toFixed(2))
    : null;

  const payload = {
    timestamp: new Date(timestampMs ?? Date.now()).toISOString(),
    product: ongoingTransaction.product,
    price: ongoingTransaction.price,
    inserted: ongoingTransaction.inserted,
    weight,
    status,
    reason,
    rawLine,
  };

  // Preserve the last known inserted amount so summary/failed lines that
  // arrive after `ongoingTransaction` is cleared can still report the
  // real inserted value instead of defaulting to 0.
  lastKnownInserted = Number.isFinite(ongoingTransaction.inserted) ? ongoingTransaction.inserted : lastKnownInserted;

  ongoingTransaction = null;
  return payload;
}

/**
 * @param {ParsedEventLine | null | undefined} parsed
 * @param {number} [nowMs]
 * @returns {TransactionPayload | null}
 */
function consumeEventTransaction(parsed, nowMs = Date.now()) {
  if (!parsed) return null;

  const eventName = normalizeEvent(parsed.event);
  if (!eventName) return null;

  if ((eventName.includes("product removed") || eventName.startsWith("pay ")) && parsed.product) {
    const product = formatTransactionProduct(parsed.product);
    const price = inferPriceFromProduct(parsed.product);

    if (product && price !== null) {
      ongoingTransaction = {
        product,
        price,
        inserted: 0,
        weight: 0,
        failureReason: null,
        attemptedCoinValue: null,
        pendingCoinValue: null,
        startedAtMs: nowMs,
        lastActivityAtMs: nowMs,
      };
    }
    return null;
  }

  if (!ongoingTransaction) return null;

  if (eventName === "coin detected" && parsed.product) {
    const coinValue = inferPriceFromProduct(parsed.product);
    if (coinValue !== null) {
      if (ongoingTransaction.pendingCoinValue !== coinValue) {
        ongoingTransaction.inserted += coinValue;
      }
      ongoingTransaction.weight += parseWeightValue(parsed.weight);
      ongoingTransaction.attemptedCoinValue = coinValue;
      ongoingTransaction.pendingCoinValue = ongoingTransaction.pendingCoinValue === coinValue ? null : coinValue;
      ongoingTransaction.lastActivityAtMs = nowMs;
    }
    return null;
  }

  if (eventName === "inserted balance") {
    const insertedAmount = parseInsertedAmount(parsed.rawLine, parsed.product);
    if (insertedAmount !== null) {
      const isDuplicateOfDetectedCoin = ongoingTransaction.pendingCoinValue === insertedAmount;
      if (!isDuplicateOfDetectedCoin) {
        ongoingTransaction.inserted += insertedAmount;
      }
      ongoingTransaction.attemptedCoinValue = insertedAmount;
      ongoingTransaction.pendingCoinValue = isDuplicateOfDetectedCoin ? null : insertedAmount;
      ongoingTransaction.lastActivityAtMs = nowMs;
    }
    return null;
  }

  if (eventName === "invalid coin") {
    const paymentStatus = normalizeEvent(parsed.paymentStatus);
    const normalizedRawLine = unwrapRawLine(parsed.rawLine);
    ongoingTransaction.failureReason = deriveFailedReason(ongoingTransaction);

    if (paymentStatus === "no coin detected" || paymentStatus === "insufficient" || /payment invalid|payment incomplete|add more coins/i.test(normalizedRawLine)) {
      return buildTransactionPayload({
        status: "FAILED",
        reason: ongoingTransaction.failureReason,
        rawLine: parsed.rawLine,
        timestampMs: nowMs,
      });
    }

    ongoingTransaction.lastActivityAtMs = nowMs;
    return null;
  }

  if (eventName === "payment incomplete" || eventName === "add more coins") {
    if (!ongoingTransaction.failureReason) {
      ongoingTransaction.failureReason = deriveFailedReason(ongoingTransaction);
    }
    ongoingTransaction.lastActivityAtMs = nowMs;
    return null;
  }

  if (eventName === "payment ok") {
    return buildTransactionPayload({
      status: "SUCCESS",
      reason: "VALID",
      rawLine: parsed.rawLine,
      timestampMs: nowMs,
    });
  }

  if (eventName === "customer left" || eventName === "honestpay ready") {
    const elapsedSinceLastActivity = nowMs - ongoingTransaction.lastActivityAtMs;
    if (elapsedSinceLastActivity < PAYMENT_GRACE_MS) {
      return null;
    }

    const fallbackReason = deriveFailedReason(ongoingTransaction);
    return buildTransactionPayload({
      status: "FAILED",
      reason: ongoingTransaction.failureReason || fallbackReason,
      rawLine: parsed.rawLine,
      timestampMs: nowMs,
    });
  }

  return null;
}

/** @param {unknown} rawLine
 *  @returns {ParsedTransactionLine | null}
 */
function parseTransactionLine(rawLine) {
  const raw = String(rawLine || "").trim();
  if (!raw) return null;

  const successMatch = raw.match(/^transaction:success:([^:]+):php(\d+)$/i);
  if (successMatch) {
    return {
      kind: "transaction",
      status: "SUCCESS",
      product: formatTransactionProduct(successMatch[1]),
      price: Number(successMatch[2]),
      inserted: Number(successMatch[2]),
      weight: null,
      reason: "VALID",
      rawLine: raw,
    };
  }

  const failedMatch = raw.match(/^transaction:failed:([^:]+):([a-z]+)$/i);
  if (failedMatch) {
    const reason = failedMatch[2].toUpperCase();
    const product = formatTransactionProduct(failedMatch[1]);
    const price = inferPriceFromProduct(failedMatch[1]);

    // Prefer explicit inserted amounts encoded in the raw line, then
    // prefer the active `ongoingTransaction` value, then fall back to the
    // last preserved inserted amount if available. Only fallback to 0 as
    // a last resort.
    const explicitInserted = parseInsertedExplicit(raw);
    let insertedVal = 0;
    if (ongoingTransaction && Number.isFinite(ongoingTransaction.inserted)) {
      insertedVal = ongoingTransaction.inserted;
    } else if (explicitInserted !== null) {
      insertedVal = explicitInserted;
    } else if (Number.isFinite(lastKnownInserted)) {
      insertedVal = Number(lastKnownInserted);
      // consume it so it won't be reused for unrelated later lines
      lastKnownInserted = null;
    } else {
      insertedVal = 0;
    }

    return {
      kind: "transaction",
      status: "FAILED",
      product,
      price,
      inserted: insertedVal,
      weight: null,
      reason: reason === "INVALID" || reason === "INSUFFICIENT" ? reason : "INVALID",
      rawLine: raw,
    };
  }

  return null;
}

/** @param {unknown} rawLine
 *  @returns {ParsedLine | null}
 */
function parseSmartPayLine(rawLine) {
  const raw = String(rawLine || "").trim();
  if (!raw) return null;

  const transaction = parseTransactionLine(raw);
  if (transaction) {
    return transaction;
  }

  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw);
      const event = normalizeEvent(parsed?.event);
      if (!event) return null;
      const normalizedRawLine = unwrapRawLine(typeof parsed?.rawLine === "string" ? parsed.rawLine : raw) || raw;

      return {
        kind: "event",
        event: parsed.event.trim(),
        product: typeof parsed.product === "string" ? parsed.product : null,
        paymentStatus: typeof parsed.paymentStatus === "string" ? parsed.paymentStatus : null,
        weight: typeof parsed.weight === "string" ? parsed.weight : null,
        rawLine: normalizedRawLine,
      };
    } catch {
      return null;
    }
  }

  const verboseTelemetryMatch = raw.match(
    /^product\s+weight:\s*([+-]?\d+(?:\.\d+)?)\s*g\s*\|\s*coin\s+weight:\s*([+-]?\d+(?:\.\d+)?)\s*g\s*\|\s*product\s+type:\s*(\d+)\s*\|\s*coin\s+value:\s*(\d+)\s*\|\s*payment:\s*(ok|not\s+ok)$/i
  );
  if (verboseTelemetryMatch) {
    const productType = Number(verboseTelemetryMatch[3]);
    const coinValue = Number(verboseTelemetryMatch[4]);

    if (!Number.isFinite(coinValue) || coinValue <= 0) {
      verboseTelemetryRuntime.lastCoinValue = 0;
      verboseTelemetryRuntime.lastProductType = productType;
      return null;
    }

    const isNewCoinEdge =
      verboseTelemetryRuntime.lastCoinValue !== coinValue ||
      verboseTelemetryRuntime.lastProductType !== productType;

    verboseTelemetryRuntime.lastCoinValue = coinValue;
    verboseTelemetryRuntime.lastProductType = productType;

    if (!isNewCoinEdge) {
      return null;
    }

    return {
      kind: "event",
      event: "Inserted Balance",
      product: productType === 1 ? "Product One (PHP5)" : productType === 2 ? "Product Two (PHP10)" : null,
      paymentStatus: "Pending",
      weight: `${Number(verboseTelemetryMatch[2]).toFixed(2)}g`,
      rawLine: raw,
    };
  }

  if (/^distance:\s*/i.test(raw) || /^product:\s*/i.test(raw)) {
    return null;
  }

  // Ignore verbose telemetry lines from the Arduino that aren't events
  // Examples: "Product Weight: 0.00 g | Coin Weight: 0.00 g | Product Type: 0 | Coin Value: 0"
  if (/product\s+weight|coin\s+weight|product\s+type|coin\s+value|payment\s*:\s*not\b/i.test(raw)) {
    return null;
  }

  if (/^entry(?:\s*:\s*\d+)?$/i.test(raw)) {
    return { kind: "event", event: "Entry", product: null, paymentStatus: null, weight: null, rawLine: raw };
  }

  if (/^customer(?:\s+|_)entered\b/i.test(raw)) {
    return { kind: "event", event: "Customer Entered", product: null, paymentStatus: null, weight: null, rawLine: raw };
  }

  const contractProductRemovedMatch = raw.match(/^no\s+product\s*-\s*(p[12])\s*:\s*([+-]?\d+(?:\.\d+)?)g\s*=\s*p(?:5|10)$/i);
  if (contractProductRemovedMatch) {
    return {
      kind: "event",
      event: "Product Removed",
      product: formatProductLabel(contractProductRemovedMatch[1]),
      paymentStatus: "Pending",
      weight: `${Number(contractProductRemovedMatch[2]).toFixed(2)}g`,
      rawLine: raw,
    };
  }

  const contractInsertCoinMatch = raw.match(/^insert\s+coin\s*-\s*coin\s*:\s*(5|10)\s*pesos$/i);
  if (contractInsertCoinMatch) {
    return {
      kind: "event",
      event: "Inserted Balance",
      product: contractInsertCoinMatch[1] === "5" ? "Product One (PHP5)" : "Product Two (PHP10)",
      paymentStatus: "Pending",
      weight: null,
      rawLine: raw,
    };
  }

  if (/^insert\s+coin\s*-\s*\(no\s+coin\)$/i.test(raw)) {
    return {
      kind: "event",
      event: "Invalid Coin",
      product: null,
      paymentStatus: "No coin detected",
      weight: null,
      rawLine: raw,
    };
  }

  const paymentStatusMatch = raw.match(/^payment\s+status:\s*(insufficient|no\s+coin\s+detected)$/i);
  if (paymentStatusMatch) {
    return {
      kind: "event",
      event: "Invalid Coin",
      product: null,
      paymentStatus: paymentStatusMatch[1].toLowerCase() === "insufficient" ? "Insufficient" : "No coin detected",
      weight: null,
      rawLine: raw,
    };
  }

  const productRemovedMatch = raw.match(/^product removed\.?\s*pay\s*(.+)$/i);
  if (productRemovedMatch) {
    const product = formatProductLabel(productRemovedMatch[1]);
    return {
      kind: "event",
      event: "Product Removed",
      product,
      paymentStatus: null,
      weight: null,
      rawLine: raw,
    };
  }

  const payPromptMatch = raw.match(/^pay\s+(.+)$/i);
  if (payPromptMatch) {
    const product = formatProductLabel(payPromptMatch[1]);
    return {
      kind: "event",
      event: product ? `Pay ${product}` : "Pay",
      product,
      paymentStatus: null,
      weight: null,
      rawLine: raw,
    };
  }

  const coinDetectedMatch = raw.match(/^coin detected:\s*([\d.]+)g\s*->\s*php(5|10)(?:\s*accepted)?$/i);
  if (coinDetectedMatch) {
    return {
      kind: "event",
      event: "Coin Detected",
      product: coinDetectedMatch[2] === "5" ? "Product One (PHP5)" : "Product Two (PHP10)",
      paymentStatus: "Verified",
      weight: `${Number(coinDetectedMatch[1]).toFixed(2)}g`,
      rawLine: raw,
    };
  }

  const insertedMatch = raw.match(/^inserted:\s*php(\d+)$/i);
  if (insertedMatch) {
    return {
      kind: "event",
      event: "Inserted Balance",
      product: null,
      paymentStatus: null,
      weight: null,
      rawLine: raw,
    };
  }

  const remainingMatch = raw.match(/^remaining:\s*php(\d+)$/i);
  if (remainingMatch) {
    return null;
  }

  if (/^dispensing product\.?$/i.test(raw)) {
    return { kind: "event", event: "Dispensing Product", product: null, paymentStatus: null, weight: null, rawLine: raw };
  }

  if (/^payment ok$/i.test(raw)) {
    return { kind: "event", event: "Payment OK", product: null, paymentStatus: "Verified", weight: null, rawLine: raw };
  }

  if (/^waiting\s+payment\s*-\s*payment\s+success$/i.test(raw)) {
    return { kind: "event", event: "Payment OK", product: null, paymentStatus: "Verified", weight: null, rawLine: raw };
  }

  if (/^(?:waiting\s+payment\s*-\s*)?payment\s+invalid$/i.test(raw)) {
    return { kind: "event", event: "Invalid Coin", product: null, paymentStatus: "Insufficient", weight: null, rawLine: raw };
  }

  if (/^payment incomplete$/i.test(raw)) {
    return { kind: "event", event: "Invalid Coin", product: null, paymentStatus: "Insufficient", weight: null, rawLine: raw };
  }

  if (/^add more coins$/i.test(raw)) {
    return { kind: "event", event: "Invalid Coin", product: null, paymentStatus: "Insufficient", weight: null, rawLine: raw };
  }

  if (/^customer left$/i.test(raw)) {
    return { kind: "event", event: "Customer Left", product: null, paymentStatus: null, weight: null, rawLine: raw };
  }

  if (/^(smartpay|honestpay) ready$/i.test(raw)) {
    return { kind: "event", event: "HonestPay Ready", product: null, paymentStatus: null, weight: null, rawLine: raw };
  }

  return null;
}

/** @param {any} payload */
async function postToVercel(payload) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  return text;
}

/** @param {number} nowMs */
function shouldDropDuplicate(nowMs) {
  if (nowMs - lastSentAt < DEDUPE_WINDOW_MS) {
    return true;
  }
  lastSentAt = nowMs;
  return false;
}

/** @param {string} eventName */
function isPirEventName(eventName) {
  return eventName === "entry" || eventName === "customer entered" || eventName === "customer_entered";
}

/** @param {string} eventName */
function isEntryOnlyPirEvent(eventName) {
  return eventName === "entry";
}

/** @param {number} nowMs */
function shouldDropPirDuplicate(nowMs) {
  return nowMs - lastPirSentAt < DEDUPE_WINDOW_MS;
}

async function start() {
    let portPath = REQUESTED_SERIAL_PORT;
    if (!portPath || portPath === "auto") {
      try {
        const ports = await SerialPort.list();
        if (!ports || ports.length === 0) {
          console.error("Serial error: No serial ports found to open");
          process.exit(1);
        }
        console.log(`[AUTO] Serial ports detected: ${ports.map(p => p.path).join(', ')}`);
        portPath = ports[0].path;
      } catch (err) {
        console.error("Serial error while listing ports:", err instanceof Error ? err.message : err);
        process.exit(1);
      }
    }

    const port = new SerialPort({
      path: portPath,
      baudRate: BAUD_RATE,
    });

  const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

  port.on("open", () => {
    console.log(`Bridge connected on ${portPath} @ ${BAUD_RATE}`);
    console.log(`Forwarding JSON events to ${API_URL}`);
  });

  port.on("error", (err) => {
    console.error(`Serial error: ${err.message}`);
  });

  parser.on("data", async (line) => {
    const raw = String(line || "").trim();
    if (!raw) return;

    console.log(`[RAW] ${raw}`);

    const parsed = parseSmartPayLine(raw);
    if (!parsed) {
      return;
    }

    if (parsed.kind === "transaction") {
      const transaction = parsed;
      const now = Date.now();
      if (shouldDropDuplicate(now)) {
        console.warn("[SKIP] Duplicate transaction within dedupe window");
        return;
      }

      if (!transaction.product || transaction.price === null) {
        console.warn("[SKIP] Transaction line missing normalized product or price");
        return;
      }

      const payload = {
        timestamp: new Date().toISOString(),
        product: transaction.product,
        price: transaction.price,
        inserted: transaction.inserted,
        weight: transaction.weight,
        status: transaction.status,
        reason: transaction.reason,
        rawLine: transaction.rawLine,
      };

      try {
        await postToVercel(payload);
        console.log(`[SENT] transaction:${payload.status.toLowerCase()}`);
      } catch (err) {
        console.error(`[POST ERROR] ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    if (parsed.kind !== "event") {
      return;
    }

    let eventName = normalizeEvent(parsed.event);
    if (!eventName) {
      return;
    }

    // Normalize ALL PIR event name variants to a single canonical name
    // before any deduplication or filtering. This ensures "Entry",
    // "Customer Entered", "customer_entered", etc. are treated the same.
    if (isPirEventName(eventName)) {
      eventName = "entry";
    }

    const payload = consumeEventTransaction(parsed, Date.now());

    if (!payload) {
      if (eventName === "entry") {
        const now = Date.now();
        if (shouldDropPirDuplicate(now)) {
          console.warn(`[SKIP] Duplicate PIR event within dedupe window: ${eventName}`);
          return;
        }

        // Post minimal PIR event rows so the remote API/counter can count entries.
        const eventPayload = {
          timestamp: new Date().toISOString(),
          event: parsed.event,
          product: parsed.product ?? null,
          paymentStatus: parsed.paymentStatus ?? null,
          weight: parsed.weight ?? null,
          rawLine: parsed.rawLine ?? null,
        };

        if (!ALLOW_EVENT_POSTS) {
          console.log(`[SKIP] Event posts disabled; not sending PIR event: ${eventName}`);
        } else {
          try {
            // Ensure the API receives the canonical event name but keep
            // the original rawLine so downstream can see the exact source.
            await postToVercel({ ...eventPayload, event: "Entry" });
            // Only start the PIR dedupe window after a successful POST
            lastPirSentAt = now;
            console.log(`[SENT] event:entry`);
          } catch (err) {
            console.error(`[POST ERROR] ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }

      return;
    }

    const now = Date.now();
    if (shouldDropDuplicate(now)) {
      console.warn(`[SKIP] Duplicate completed transaction within dedupe window: ${payload.status.toLowerCase()}`);
      return;
    }

    try {
      await postToVercel(payload);
      console.log(`[SENT] transaction:${payload.status.toLowerCase()}`);
    } catch (err) {
      console.error(`[POST ERROR] ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

function resetBridgeStateForTests() {
  lastSentAt = 0;
  lastPirSentAt = 0;
  lastKnownInserted = null;
  ongoingTransaction = null;
}

if (require.main === module) {
  start();
} else {
  module.exports = {
    PAYMENT_GRACE_MS,
    parseSmartPayLine,
    consumeEventTransaction,
    resetBridgeStateForTests,
  };
}
