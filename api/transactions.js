// @ts-nocheck

const MAX_ROWS = 1000;
const DEDUPE_WINDOW_MS = 3000;
const EVENT_DEDUPE_WINDOW_MS = 1500;
const PIR_EVENT_DEDUPE_WINDOW_MS = 4000;

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

function normalizeEvent(value) {
  return normalizeText(value).replace(/\s+/g, " ");
}

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

function isPirEventValue(value) {
  const event = normalizeEvent(value);
  return event === "entry" || event === "customer entered" || event === "customer_entered";
}

function rowLooksLikePir(row) {
  if (isPirEventValue(row?.event)) return true;
  if (typeof row?.rawLine !== "string") return false;
  const raw = unwrapRawLine(row.rawLine).toLowerCase();
  return /^entry(?:\s*:\s*\d+)?$/i.test(raw) || /^customer(?:\s+|_)entered\b/i.test(raw);
}

function getPirEventKey(row) {
  if (!rowLooksLikePir(row)) return null;

  const raw = unwrapRawLine(row?.rawLine);
  const entryMatch = raw.match(/^entry\s*:\s*(\d+)$/i);
  if (entryMatch) {
    return `entry:${entryMatch[1]}`;
  }

  const event = normalizeEvent(row?.event);
  if (event === "entry") {
    return raw ? `entry:${normalizeText(raw)}` : "entry";
  }

  if (/^customer(?:\s+|_)entered\b/i.test(raw) || event === "customer entered" || event === "customer_entered") {
    return "customer_entered";
  }

  return raw ? normalizeText(raw) : event || null;
}

function isDuplicateTransaction(store, candidate) {
  const now = Date.now();
  return store.find((row) => {
    const ts = Date.parse(row.timestamp);
    if (!Number.isFinite(ts)) return false;
    if (now - ts > DEDUPE_WINDOW_MS) return false;

    return (
      normalizeText(unwrapRawLine(row.rawLine)) === normalizeText(unwrapRawLine(candidate.rawLine)) &&
      normalizeText(row.product) === normalizeText(candidate.product) &&
      normalizeText(row.status) === normalizeText(candidate.status) &&
      normalizeText(row.reason) === normalizeText(candidate.reason) &&
      String(row.price ?? "") === String(candidate.price ?? "") &&
      String(row.inserted ?? "") === String(candidate.inserted ?? "")
    );
  });
}

function isDuplicateEvent(store, candidate) {
  const now = Date.now();
  const candidateIsPir = rowLooksLikePir(candidate);
  const windowMs = candidateIsPir ? PIR_EVENT_DEDUPE_WINDOW_MS : EVENT_DEDUPE_WINDOW_MS;
  const candidatePirKey = candidateIsPir ? getPirEventKey(candidate) : null;

  return store.find((row) => {
    const ts = Date.parse(row.timestamp);
    if (!Number.isFinite(ts)) return false;
    if (now - ts > windowMs) return false;

    if (candidateIsPir) {
      if (!rowLooksLikePir(row)) return false;

      const rowPirKey = getPirEventKey(row);
      if (candidatePirKey && rowPirKey) {
        return rowPirKey === candidatePirKey;
      }

      return (
        normalizeEvent(row.event) === normalizeEvent(candidate.event) &&
          normalizeText(unwrapRawLine(row.rawLine)) === normalizeText(unwrapRawLine(candidate.rawLine))
      );
    }

    return (
      normalizeEvent(row.event) === normalizeEvent(candidate.event) &&
      normalizeText(unwrapRawLine(row.rawLine)) === normalizeText(unwrapRawLine(candidate.rawLine)) &&
      normalizeText(row.product) === normalizeText(candidate.product) &&
      normalizeText(row.paymentStatus) === normalizeText(candidate.paymentStatus)
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

function parseInsertedFromRaw(rawLine) {
  const raw = unwrapRawLine(rawLine);
  if (!raw) return null;
  const m = raw.match(/inserted:\s*php(\d+)/i);
  if (m) return Number.parseInt(m[1], 10);
  const m2 = raw.match(/coin\s*:\s*(5|10)\s*pesos/i);
  if (m2) return Number.parseInt(m2[1], 10);
  const m4 = raw.match(/coin\s+value:\s*(5|10)\b/i);
  if (m4) return Number.parseInt(m4[1], 10);
  const m3 = raw.match(/php\s*(\d+)\b/i);
  if (m3) return Number.parseInt(m3[1], 10);
  return null;
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
      // Accept event-only rows (e.g., PIR "Entry") so counters can be computed
      if (typeof body?.event === "string" && body.event.trim()) {
        const candidate = {
          id: Date.now(),
          timestamp: body.timestamp ? new Date(body.timestamp).toISOString() : new Date().toISOString(),
          event: body.event,
          product: typeof body.product === "string" ? body.product : null,
          paymentStatus: typeof body.paymentStatus === "string" ? body.paymentStatus : null,
          weight: body.weight ?? null,
          rawLine: typeof body.rawLine === "string" ? (unwrapRawLine(body.rawLine) || body.rawLine) : null,
        };

        const duplicate = isDuplicateEvent(store, candidate);
        if (duplicate) {
          return sendJson(res, 200, { ok: true, duplicate: true, row: duplicate });
        }

        store.unshift(candidate);
        if (store.length > MAX_ROWS) store.length = MAX_ROWS;

        return sendJson(res, 201, { ok: true, duplicate: false, row: candidate });
      }
      const status = normalizeStatus(body?.status);
      const reason = normalizeReason(body?.reason);
      const product = normalizeProduct(body?.product);
      const price = Number(body?.price);
      let inserted = Number(body?.inserted ?? price);
      const weight = body?.weight ?? null;

      // Only treat non-finite values as missing. Do NOT treat `0` as missing
      // because `0` is a valid inserted amount that must be preserved.
      if (!Number.isFinite(inserted)) {
        const fromRaw = parseInsertedFromRaw(body?.rawLine ?? "");
        if (Number.isFinite(fromRaw)) inserted = fromRaw;
      }

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
        rawLine: typeof body.rawLine === "string" ? (unwrapRawLine(body.rawLine) || body.rawLine) : null,
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
