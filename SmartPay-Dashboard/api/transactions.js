const MAX_ROWS = 1000;
const DEDUPE_WINDOW_MS = 3000;

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

function normalizeText(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function isDuplicateEvent(store, candidate) {
  const now = Date.now();
  return store.find((row) => {
    const ts = Date.parse(row.timestamp);
    if (!Number.isFinite(ts)) return false;
    if (now - ts > DEDUPE_WINDOW_MS) return false;

    return (
      normalizeText(row.event) === normalizeText(candidate.event) &&
      normalizeText(row.rawLine) === normalizeText(candidate.rawLine) &&
      normalizeText(row.product) === normalizeText(candidate.product) &&
      normalizeText(row.paymentStatus) === normalizeText(candidate.paymentStatus) &&
      normalizeText(row.weight) === normalizeText(candidate.weight)
    );
  });
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

      const candidate = {
        event: body.event,
        product: body.product ?? null,
        paymentStatus: body.paymentStatus ?? null,
        weight: body.weight ?? null,
        rawLine: body.rawLine ?? null,
      };

      const duplicate = isDuplicateEvent(store, candidate);
      if (duplicate) {
        return sendJson(res, 200, { ok: true, duplicate: true, row: duplicate });
      }

      const row = {
        id: Date.now(),
        timestamp: body.timestamp ? new Date(body.timestamp).toISOString() : new Date().toISOString(),
        ...candidate,
      };

      store.unshift(row);
      if (store.length > MAX_ROWS) store.length = MAX_ROWS;

      return sendJson(res, 201, { ok: true, duplicate: false, row });
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message || "invalid json" });
    }
  }

  return sendJson(res, 405, { ok: false, error: "method not allowed" });
}
