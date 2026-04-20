const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");
const axios = require("axios");

// CHANGE THIS TO YOUR ACTUAL COM PORT (Windows), e.g. COM5
const COM_PORT = "COM5";
const BAUD_RATE = 9600;

// CHANGE THIS TO YOUR Vercel project base URL (no trailing slash)
// Example: https://your-app.vercel.app
const VERCEL_BASE_URL = "https://smartpay-dashboard-git-smartpay-5bec8c-chinne-bugtongs-projects.vercel.app";
const API_CANDIDATES = ["/api/transactions", "/api/events"];
let API_URL = null;

async function resolveApiUrl() {
  for (const path of API_CANDIDATES) {
    const url = `${VERCEL_BASE_URL}${path}`;
    try {
      const res = await axios.get(url, { timeout: 5000 });
      if (res.status >= 200 && res.status < 500) {
        API_URL = url;
        console.log(`Using API endpoint: ${API_URL}`);
        return;
      }
    } catch {
      // try next candidate
    }
  }

  API_URL = `${VERCEL_BASE_URL}/api/events`;
  console.error("No supported API endpoint found on this deployment.");
  console.error("Tried:", API_CANDIDATES.map((p) => `${VERCEL_BASE_URL}${p}`).join(" , "));
  console.error("If this is a static-only Vercel build, API routes do not exist.");
}

function parseTextLine(line) {
  const raw = line.trim();
  if (!raw) return null;

  let event = raw;
  let product = null;
  let paymentStatus = null;
  let weight = null;

  if (/^entry\s*:/i.test(raw)) event = "Entry";
  else if (/^customer entered$/i.test(raw) || /^customer_entered$/i.test(raw)) event = "Customer Entered";
  else if (/^customer left$/i.test(raw)) event = "Customer Left";
  else if (/^smartpay ready/i.test(raw)) event = "SmartPay Ready";
  else if (/^payment ok$/i.test(raw)) {
    event = "Payment OK";
    paymentStatus = "Verified";
  } else if (/^add more coins$/i.test(raw)) {
    event = "Add More Coins";
    paymentStatus = "Insufficient";
  } else if (/^dispensing product/i.test(raw)) event = "Dispensing Product";
  else if (/product removed/i.test(raw)) {
    event = "Product Removed";
    const productMatch = raw.match(/product\s+(one|two)|php\s*(5|10)/i);
    if (productMatch) {
      if (/one/i.test(productMatch[0]) || /5/.test(productMatch[0])) product = "Product One (PHP5)";
      if (/two/i.test(productMatch[0]) || /10/.test(productMatch[0])) product = "Product Two (PHP10)";
    }
  } else if (/^pay\s+/i.test(raw)) {
    event = raw;
    paymentStatus = "Pending";
    if (/php\s*5/i.test(raw) || /product\s*one/i.test(raw)) product = "Product One (PHP5)";
    if (/php\s*10/i.test(raw) || /product\s*two/i.test(raw)) product = "Product Two (PHP10)";
  } else if (/^coin detected:/i.test(raw)) {
    event = "Coin Detected";
    const w = raw.match(/coin\s+detected:\s*([\d.]+)g/i);
    if (w) weight = `${w[1]}g`;
    if (/php\s*5/i.test(raw)) product = "Product One (PHP5)";
    if (/php\s*10/i.test(raw)) product = "Product Two (PHP10)";
  } else if (/^inserted:\s*(php|₱)\s*\d+/i.test(raw)) {
    event = "Inserted Balance";
  } else if (/^remaining:\s*(php|₱)\s*\d+/i.test(raw)) {
    event = "Remaining Balance";
  }

  return {
    timestamp: new Date().toISOString(),
    event,
    product,
    paymentStatus,
    weight,
    rawLine: raw,
  };
}

function parseLineToPayload(line) {
  const raw = line.trim();
  if (!raw) return null;

  // If Arduino sends JSON, try to map it directly.
  if (raw.startsWith("{")) {
    try {
      const j = JSON.parse(raw);
      const eventRaw = typeof j.event === "string" ? j.event.trim() : "";
      const event = eventRaw || (typeof j.coin === "number" && j.coin > 0 ? "Coin Detected" : "Telemetry");

      let product = null;
      if (typeof j.product === "number") {
        if (j.product === 1) product = "Product One (PHP5)";
        if (j.product === 2) product = "Product Two (PHP10)";
      }

      const weightValue = typeof j.product_w === "number" ? j.product_w : (typeof j.coin_w === "number" ? j.coin_w : null);
      const weight = typeof weightValue === "number" ? `${weightValue.toFixed(2)}g` : null;

      return {
        timestamp: new Date().toISOString(),
        event,
        product,
        paymentStatus: null,
        weight,
        rawLine: raw,
      };
    } catch {
      return null;
    }
  }

  return parseTextLine(raw);
}

const port = new SerialPort({
  path: COM_PORT,
  baudRate: BAUD_RATE,
});

const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

port.on("open", () => {
  console.log(`Gateway connected to ${COM_PORT} @ ${BAUD_RATE}`);
  console.log(`Forwarding to ${API_URL ?? "(resolving...)"}`);
});

port.on("error", (err) => {
  console.error("Serial port error:", err.message);
});

parser.on("data", async (line) => {
  const payload = parseLineToPayload(line);
  if (!payload) return;

  // Drop telemetry-only noise to keep table clean.
  if (payload.event.toLowerCase() === "telemetry") return;

  try {
    if (!API_URL) {
      console.error("Skipping send: API endpoint not resolved.");
      return;
    }

    await axios.post(API_URL, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 5000,
    });
    console.log("Sent:", payload.event, "|", payload.rawLine);
  } catch (err) {
    const msg = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error("POST failed:", msg);
  }
});

resolveApiUrl().catch((err) => {
  console.error("API discovery failed:", err.message);
});
