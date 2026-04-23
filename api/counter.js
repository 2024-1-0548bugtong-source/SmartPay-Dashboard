function getStore() {
  if (!globalThis.__smartpayTransactions) {
    globalThis.__smartpayTransactions = [];
  }
  return globalThis.__smartpayTransactions;
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

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return sendJson(res, 200, { ok: true });
  }

  if (req.method !== "GET") {
    return sendJson(res, 405, { ok: false, error: "method not allowed" });
  }

  const store = getStore();
  const customerEnteredCount = store.filter((row) => normalizeEvent(row.event) === "customer_entered").length;

  return sendJson(res, 200, {
    ok: true,
    event: "customer_entered",
    count: customerEnteredCount,
    totalRows: store.length,
    updatedAt: new Date().toISOString(),
  });
};
