const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");

const SERIAL_PORT = process.env.SERIAL_PORT || process.argv[2] || "/dev/ttyACM0";
const BAUD_RATE = Number(process.env.BAUD_RATE || 9600);
const WEB_PORT = Number(process.env.WEB_PORT || 3000);
const DEDUPE_WINDOW_MS = Number(process.env.DEDUPE_WINDOW_MS || 1200);
const DASHBOARD_DIST_DIR = path.join(__dirname, "SmartPay-Dashboard", "artifacts", "smartpay-dashboard", "dist");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

let customerCount = 0;
let lastEvent = "";
let lastEventAt = 0;
let transactionStore = [];
const MAX_TRANSACTIONS = 1000;

// ── STARTUP: Clear all in-memory transactions ──
console.log("[STARTUP] ✓ Transaction store initialized (empty)");
console.log("[STARTUP] ✓ All old transactions cleared from memory");

app.use(express.static(DASHBOARD_DIST_DIR));
app.use(express.json());

app.get("/", (_req, res) => {
  res.sendFile(path.join(DASHBOARD_DIST_DIR, "index.html"));
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, serialPort: SERIAL_PORT, baudRate: BAUD_RATE, count: customerCount });
});

// Transaction endpoints with Socket.io integration
app.get("/api/transactions", (_req, res) => {
  res.json(transactionStore);
});

app.delete("/api/transactions", (_req, res) => {
  transactionStore = [];
  res.json({ ok: true, cleared: true });
});

app.post("/api/transactions", (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body.event !== "string" || !body.event.trim()) {
      return res.status(400).json({ ok: false, error: "event is required" });
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

    transactionStore.unshift(row);
    if (transactionStore.length > MAX_TRANSACTIONS) {
      transactionStore = transactionStore.slice(0, MAX_TRANSACTIONS);
    }

    // Emit real-time update to all connected clients
    io.emit("transaction:added", row);

    res.status(201).json({ ok: true, row });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || "invalid json" });
  }
});

io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id}`);
  socket.emit("counter_update", { count: customerCount });
  socket.emit("transactions:load", transactionStore);

  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

function shouldCountEvent(eventName, nowMs) {
  if (eventName !== "customer_entered") return false;

  const isDuplicate = lastEvent === eventName && (nowMs - lastEventAt) < DEDUPE_WINDOW_MS;
  if (isDuplicate) {
    return false;
  }

  lastEvent = eventName;
  lastEventAt = nowMs;
  return true;
}

function handleJsonLine(rawLine) {
  const normalized = String(rawLine || "").trim();
  if (!normalized) return;

  console.log(`[RAW] ${normalized}`);

  let payload;
  try {
    payload = JSON.parse(normalized);
  } catch (_err) {
    console.warn(`[WARN] Invalid JSON ignored: ${normalized}`);
    return;
  }

  if (!payload || typeof payload.event !== "string") {
    console.warn("[WARN] Missing string event field, ignored.");
    return;
  }

  const eventName = payload.event.trim().toLowerCase();
  const now = Date.now();

  if (shouldCountEvent(eventName, now)) {
    customerCount += 1;
    console.log(`[COUNT] customer_entered => ${customerCount}`);
    io.emit("counter_update", { count: customerCount });
  }
}

function startSerial() {
  const port = new SerialPort({
    path: SERIAL_PORT,
    baudRate: BAUD_RATE,
  });

  const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

  port.on("open", () => {
    console.log(`[SERIAL] Connected to ${SERIAL_PORT} @ ${BAUD_RATE}`);
  });

  port.on("error", (err) => {
    console.error(`[SERIAL ERROR] ${err.message}`);
  });

  parser.on("data", handleJsonLine);
}

server.listen(WEB_PORT, () => {
  console.log(`[WEB] Dashboard: http://localhost:${WEB_PORT}`);
  startSerial();
});
