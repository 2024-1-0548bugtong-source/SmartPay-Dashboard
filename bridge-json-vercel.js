const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");

const SERIAL_PORT = process.env.SERIAL_PORT || process.argv[2] || "COM5";
const BAUD_RATE = Number(process.env.BAUD_RATE || 9600);
const VERCEL_BASE_URL = (process.env.VERCEL_BASE_URL || process.argv[3] || "https://smartpay-dashboard-two.vercel.app").replace(/\/$/, "");
const API_URL = `${VERCEL_BASE_URL}/api/transactions`;
const DEDUPE_WINDOW_MS = Number(process.env.DEDUPE_WINDOW_MS || 2500);

let lastSentAt = 0;

function normalizeEvent(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
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

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn("[SKIP] Invalid JSON line");
      return;
    }

    const eventName = normalizeEvent(parsed.event);
    if (eventName !== "customer_entered") {
      console.warn(`[SKIP] Non-counter event: ${eventName || "(missing event)"}`);
      return;
    }

    const now = Date.now();
    if (shouldDropDuplicate(now)) {
      console.warn("[SKIP] Duplicate customer_entered within dedupe window");
      return;
    }

    const payload = {
      timestamp: new Date(now).toISOString(),
      event: "customer_entered",
      product: null,
      paymentStatus: null,
      weight: null,
      rawLine: raw,
    };

    try {
      await postToVercel(payload);
      console.log("[SENT] customer_entered");
    } catch (err) {
      console.error(`[POST ERROR] ${err.message}`);
    }
  });
}

start();
