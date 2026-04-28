const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");

const SERIAL_PORT = process.env.SERIAL_PORT || process.argv[2] || "COM5";
const BAUD_RATE = Number(process.env.BAUD_RATE || 9600);
const VERCEL_BASE_URL = (process.env.VERCEL_BASE_URL || process.argv[3] || "https://honest-pay-dashboard.vercel.app").replace(/\/$/, "");
const API_URL = `${VERCEL_BASE_URL}/api/transactions`;
const DEDUPE_WINDOW_MS = Number(process.env.DEDUPE_WINDOW_MS || 2500);

let lastSentAt = 0;
let lastPirSentAt = 0;

function normalizeEvent(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

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
    return {
      kind: "transaction",
      status: "FAILED",
      product: formatTransactionProduct(failedMatch[1]),
      price: failedMatch[1].toUpperCase().includes("PHP10") ? 10 : 5,
      inserted: 0,
      weight: null,
      reason: reason === "INVALID" || reason === "INSUFFICIENT" ? reason : "INVALID",
      rawLine: raw,
    };
  }

  return null;
}

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

      return {
        kind: "event",
        event: parsed.event,
        product: typeof parsed.product === "string" ? parsed.product : null,
        paymentStatus: typeof parsed.paymentStatus === "string" ? parsed.paymentStatus : null,
        weight: typeof parsed.weight === "string" ? parsed.weight : null,
        rawLine: raw,
      };
    } catch {
      return null;
    }
  }

  if (/^distance:\s*/i.test(raw) || /^product:\s*/i.test(raw)) {
    return null;
  }

  const entryMatch = raw.match(/^entry:\s*(\d+)/i);
  if (entryMatch) {
    return { kind: "event", event: "Entry", product: null, paymentStatus: null, weight: null, rawLine: raw };
  }

  if (/^customer entered\b/i.test(raw)) {
    return { kind: "event", event: "Customer Entered", product: null, paymentStatus: null, weight: null, rawLine: raw };
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

  const coinDetectedMatch = raw.match(/^coin detected:\s*([\d.]+)g\s*->\s*php(5|10)\s*accepted$/i);
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
    return {
      kind: "event",
      event: "Remaining Balance",
      product: null,
      paymentStatus: null,
      weight: null,
      rawLine: raw,
    };
  }

  if (/^dispensing product\.?$/i.test(raw)) {
    return { kind: "event", event: "Dispensing Product", product: null, paymentStatus: null, weight: null, rawLine: raw };
  }

  if (/^payment ok$/i.test(raw)) {
    return { kind: "event", event: "Payment OK", product: null, paymentStatus: "Verified", weight: null, rawLine: raw };
  }

  if (/^add more coins$/i.test(raw)) {
    return { kind: "event", event: "Add More Coins", product: null, paymentStatus: "Insufficient", weight: null, rawLine: raw };
  }

  if (/^customer left$/i.test(raw)) {
    return { kind: "event", event: "Customer Left", product: null, paymentStatus: null, weight: null, rawLine: raw };
  }

  if (/^(smartpay|honestpay) ready$/i.test(raw)) {
    return { kind: "event", event: "HonestPay Ready", product: null, paymentStatus: null, weight: null, rawLine: raw };
  }

  return null;
}

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

function shouldDropDuplicate(nowMs) {
  if (nowMs - lastSentAt < DEDUPE_WINDOW_MS) {
    return true;
  }
  lastSentAt = nowMs;
  return false;
}

function isPirEventName(eventName) {
  return eventName === "entry" || eventName === "customer entered" || eventName === "customer_entered";
}

function isEntryOnlyPirEvent(eventName) {
  return eventName === "entry";
}

function shouldDropPirDuplicate(nowMs) {
  if (nowMs - lastPirSentAt < DEDUPE_WINDOW_MS) {
    return true;
  }
  lastPirSentAt = nowMs;
  return false;
}

function start() {
  const port = new SerialPort({
    path: SERIAL_PORT,
    baudRate: BAUD_RATE,
  });

  const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

  port.on("open", () => {
    console.log(`Bridge connected on ${SERIAL_PORT} @ ${BAUD_RATE}`);
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

    const eventName = normalizeEvent(parsed.event);
    if (!eventName) {
      return;
    }

    // Keep only "Entry" as the persisted PIR event to avoid double counting
    // from paired "Entry" + "Customer Entered" Arduino lines.
    if (parsed.kind === "event" && isPirEventName(eventName) && !isEntryOnlyPirEvent(eventName)) {
      console.warn(`[SKIP] Non-entry PIR event: ${eventName}`);
      return;
    }

    const now = Date.now();
    if (parsed.kind === "event" && isPirEventName(eventName)) {
      if (shouldDropPirDuplicate(now)) {
        console.warn(`[SKIP] Duplicate PIR event within dedupe window: ${eventName}`);
        return;
      }
    } else if (parsed.kind === "event" && shouldDropDuplicate(now)) {
      console.warn(`[SKIP] Duplicate event within dedupe window: ${eventName}`);
      return;
    }

    const payload =
      parsed.kind === "transaction"
        ? {
            timestamp: new Date().toISOString(),
            product: parsed.product,
            price: parsed.price,
            inserted: parsed.inserted,
            weight: parsed.weight,
            status: parsed.status,
            reason: parsed.reason,
            rawLine: parsed.rawLine,
          }
        : {
            timestamp: new Date().toISOString(),
            event: parsed.event,
            product: parsed.product,
            paymentStatus: parsed.paymentStatus,
            weight: parsed.weight,
            rawLine: parsed.rawLine,
          };

    try {
      await postToVercel(payload);
      console.log(`[SENT] ${parsed.kind}:${eventName}`);
    } catch (err) {
      console.error(`[POST ERROR] ${err.message}`);
    }
  });
}

start();
