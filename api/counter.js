function getStore() {
  if (!globalThis.__honestpayTransactions) {
    globalThis.__honestpayTransactions = [];
  }
  return globalThis.__honestpayTransactions;
}

function getHeader(req, name) {
  const value = req?.headers?.[name];
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" ? value : null;
}

function getTransactionsUrl(req) {
  const explicitUrl = typeof process.env.TRANSACTIONS_API_URL === "string"
    ? process.env.TRANSACTIONS_API_URL.trim()
    : "";
  if (explicitUrl) return explicitUrl;

  const host = getHeader(req, "x-forwarded-host") || getHeader(req, "host");
  if (!host) return null;

  const proto = getHeader(req, "x-forwarded-proto")
    || (/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host) ? "http" : "https");

  return `${proto}://${host}/api/transactions`;
}

async function getRowsForCounter(req) {
  const transactionsUrl = getTransactionsUrl(req);

  if (transactionsUrl && typeof fetch === "function") {
    try {
      const response = await fetch(transactionsUrl, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });

      if (response.ok) {
        const rows = await response.json();
        if (Array.isArray(rows)) {
          return rows;
        }
      } else {
        console.warn(`[counter] fetch failed: ${response.status} ${transactionsUrl}`);
      }
    } catch (err) {
      console.warn(`[counter] fetch fallback to local store: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return getStore();
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

function isPirEvent(value) {
  const ev = normalizeEvent(value);
  return ev === "entry" || ev === "customer entered" || ev === "customer_entered";
}

function getCanonicalPirKey(row) {
  const raw = unwrapRawLine(row?.rawLine);
  const entryMatch = raw.match(/^entry\s*:\s*(\d+)$/i);
  if (entryMatch) {
    return `entry:${entryMatch[1]}`;
  }

  const event = normalizeEvent(row?.event);
  if (event === "entry") {
    return raw ? `entry:${raw.toLowerCase()}` : `entry:${row?.timestamp ?? "unknown"}`;
  }

  return null;
}

function isFallbackPirEvent(row) {
  const ev = normalizeEvent(row?.event);
  if (ev === "customer entered" || ev === "customer_entered") return true;
  if (typeof row?.rawLine !== "string") return false;
  return /^customer(?:\s+|_)entered\b/i.test(unwrapRawLine(row.rawLine));
}

function computePirCount(rows) {
  const PIR_DEDUPE_WINDOW_MS = 4000;

  const candidates = rows
    .filter((row) => isPirEvent(row?.event) || typeof row?.rawLine === "string")
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  let count = 0;
  let lastCountedAt = 0;
  let latestPirTimestamp = null;
  const seenCanonicalEntries = new Set();

  const hasCanonicalEntries = candidates.some((row) => getCanonicalPirKey(row) !== null);

  for (const row of candidates) {
    const ts = Date.parse(row.timestamp);
    if (!Number.isFinite(ts)) continue;

    const canonicalKey = getCanonicalPirKey(row);
    if (hasCanonicalEntries) {
      if (!canonicalKey || seenCanonicalEntries.has(canonicalKey)) {
        continue;
      }

      seenCanonicalEntries.add(canonicalKey);
      latestPirTimestamp = row.timestamp;
      count += 1;
      continue;
    }

    if (!isFallbackPirEvent(row)) {
      continue;
    }

    latestPirTimestamp = row.timestamp;

    if (ts - lastCountedAt >= PIR_DEDUPE_WINDOW_MS) {
      count += 1;
      lastCountedAt = ts;
    }
  }

  return { count, latestPirTimestamp };
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return sendJson(res, 200, { ok: true });
  }

  if (req.method !== "GET") {
    return sendJson(res, 405, { ok: false, error: "method not allowed" });
  }

  const rows = await getRowsForCounter(req);
  const pirSummary = computePirCount(rows);

  return sendJson(res, 200, {
    ok: true,
    event: "customer_entered",
    count: pirSummary.count,
    totalRows: rows.length,
    latestPirTimestamp: pirSummary.latestPirTimestamp,
    updatedAt: new Date().toISOString(),
  });
};
