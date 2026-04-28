const MAX_ROWS = 1000;
const DEDUPE_WINDOW_MS = 3000;

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

function normalizeText(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function isDuplicateTransaction(store, candidate) {
  const now = Date.now();
  return store.find((row) => {
    const ts = Date.parse(row.timestamp);
    if (!Number.isFinite(ts)) return false;
    if (now - ts > DEDUPE_WINDOW_MS) return false;

    return (
      normalizeText(row.rawLine) === normalizeText(candidate.rawLine) &&
      normalizeText(row.product) === normalizeText(candidate.product) &&
      normalizeText(row.status) === normalizeText(candidate.status) &&
      normalizeText(row.reason) === normalizeText(candidate.reason) &&
      String(row.price ?? "") === String(candidate.price ?? "") &&
      String(row.inserted ?? "") === String(candidate.inserted ?? "")
    );
  });
}

function normalizeProduct(product) {
  if (typeof product !== "string") return null;
  const value = product.trim().toUpperCase();
  if (!value) return null;
  if (value === "P1" || value.includes("PRODUCT ONE") || value.includes("PHP5")) return "P1";
  if (value === "P2" || value.includes("PRODUCT TWO") || value.includes("PHP10")) return "P2";
  return value;
}

function normalizeStatus(value) {
  const status = normalizeText(value).toUpperCase();
  return status === "SUCCESS" || status === "FAILED" ? status : null;
}

function normalizeReason(value) {
  const reason = normalizeText(value).toUpperCase();
  return reason === "VALID" || reason === "INVALID" || reason === "INSUFFICIENT" ? reason : null;
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
      const status = normalizeStatus(body?.status);
      const reason = normalizeReason(body?.reason);
      const product = normalizeProduct(body?.product);
      const price = Number(body?.price);
      const inserted = Number(body?.inserted ?? price);
      const weight = body?.weight ?? null;

      if (!status || !reason || !product || !Number.isFinite(price)) {
        return sendJson(res, 400, {
          ok: false,
          error: "transaction requires product, price, status, and reason",
        });
      }

      const candidate = {
        product,
        price,
        inserted: Number.isFinite(inserted) ? inserted : price,
        weight,
        status,
        reason,
        rawLine: body.rawLine ?? null,
      };

      const duplicate = isDuplicateTransaction(store, candidate);
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
