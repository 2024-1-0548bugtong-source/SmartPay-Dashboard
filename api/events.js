function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.end(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "GET") {
    return sendJson(res, 200, { ok: true, route: "events" });
  }

  if (req.method === "POST") {
    try {
      const proto = req.headers["x-forwarded-proto"] || "https";
      const host = req.headers.host;
      if (!host) {
        return sendJson(res, 500, { ok: false, error: "host header missing" });
      }

      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString("utf8");

      const forward = await fetch(`${proto}://${host}/api/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: raw,
      });

      const text = await forward.text();
      res.statusCode = forward.status;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.end(text);
      return;
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err.message || "forward failed" });
    }
  }

  return sendJson(res, 405, { ok: false, error: "method not allowed" });
}
