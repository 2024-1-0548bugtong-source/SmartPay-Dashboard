function getStore() {
  if (!globalThis.__honestpayTransactions) {
    globalThis.__honestpayTransactions = [];
  }
  return globalThis.__honestpayTransactions;
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.end(JSON.stringify(payload));
}

function normalizeEvent(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function isPirEvent(value) {
  const ev = normalizeEvent(value);
  return ev === "entry" || ev === "customer entered" || ev === "customer_entered";
}

function computePirCount(rows) {
  const PIR_DEDUPE_WINDOW_MS = 4000;

  function rowLooksLikePir(row) {
    if (isPirEvent(row?.event)) return true;
    if (typeof row?.rawLine !== "string") return false;
    const raw = row.rawLine.toLowerCase();
    if (/^entry:\s*\d+/i.test(raw)) return true;
    if (/\bcustomer entered\b/i.test(raw)) return true;
    if (/\bentry\b/i.test(raw)) return true;
    return false;
  }

  const candidates = rows
    .filter((row) => rowLooksLikePir(row))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  let count = 0;
  let lastCountedAt = 0;

  for (const row of candidates) {
    const ts = Date.parse(row.timestamp);
    if (!Number.isFinite(ts)) continue;

    if (ts - lastCountedAt >= PIR_DEDUPE_WINDOW_MS) {
      count += 1;
      lastCountedAt = ts;
    }
  }

  return count;
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return sendJson(res, 200, { ok: true });
  }

  if (req.method !== "GET") {
    return sendJson(res, 405, { ok: false, error: "method not allowed" });
  }

  const store = getStore();
  const customerEnteredCount = computePirCount(store);

  return sendJson(res, 200, {
    ok: true,
    event: "customer_entered",
    count: customerEnteredCount,
    totalRows: store.length,
    updatedAt: new Date().toISOString(),
  });
};
