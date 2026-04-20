const MAX_ROWS = 1000;

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
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return sendJson(res, 200, { ok: true });
  }

  const store = getStore();

  if (req.method === "GET") {
    return sendJson(res, 200, store);
  }

  if (req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      if (!body || typeof body.event !== "string" || !body.event.trim()) {
        return sendJson(res, 400, { ok: false, error: "event is required" });
      }

      const row = {
        id: Date.now(),
        timestamp: body.timestamp ? new Date(body.timestamp).toISOString() : new Date().toISOString(),
        event: body.event,
        product: body.product ?? null,
        paymentStatus: body.paymentStatus ?? null,
        weight: body.weight ?? null,
        rawLine: body.rawLine ?? null,
      };

      store.unshift(row);
      if (store.length > MAX_ROWS) store.length = MAX_ROWS;

      return sendJson(res, 201, row);
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message || "invalid json" });
    }
  }

  return sendJson(res, 405, { ok: false, error: "method not allowed" });
}
