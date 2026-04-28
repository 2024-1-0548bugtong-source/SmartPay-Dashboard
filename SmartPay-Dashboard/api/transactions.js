const MAX_ROWS = 1000;

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
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
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

  if (req.method === "DELETE") {
    store.length = 0;
    return sendJson(res, 200, { ok: true, cleared: true });
  }

  if (req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      
      // Validate required fields for new transaction structure
      if (!body.product || typeof body.product !== "string") {
        return sendJson(res, 400, { ok: false, error: "product is required (string)" });
      }
      if (typeof body.price !== "number" || body.price < 0) {
        return sendJson(res, 400, { ok: false, error: "price is required (number >= 0)" });
      }
      if (typeof body.inserted !== "number" || body.inserted < 0) {
        return sendJson(res, 400, { ok: false, error: "inserted is required (number >= 0)" });
      }
      if (typeof body.weight !== "number" || body.weight < 0) {
        return sendJson(res, 400, { ok: false, error: "weight is required (number >= 0)" });
      }
      if (!["SUCCESS", "FAILED"].includes(body.status)) {
        return sendJson(res, 400, { ok: false, error: 'status must be "SUCCESS" or "FAILED"' });
      }
      if (!["VALID", "INSUFFICIENT", "INVALID"].includes(body.reason)) {
        return sendJson(res, 400, { ok: false, error: 'reason must be "VALID", "INSUFFICIENT", or "INVALID"' });
      }

      const row = {
        id: String(Date.now()),
        timestamp: body.timestamp ? new Date(body.timestamp).toISOString() : new Date().toISOString(),
        product: body.product,
        price: body.price,
        inserted: body.inserted,
        weight: body.weight,
        status: body.status,
        reason: body.reason,
        rawLine: body.rawLine ?? null,
      };

      store.unshift(row);
      if (store.length > MAX_ROWS) store.length = MAX_ROWS;

      return sendJson(res, 201, { ok: true, row });
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message || "invalid json" });
    }
  }

  return sendJson(res, 405, { ok: false, error: "method not allowed" });
}
