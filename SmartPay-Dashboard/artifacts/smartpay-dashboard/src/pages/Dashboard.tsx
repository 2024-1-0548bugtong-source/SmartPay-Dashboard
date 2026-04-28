import { useState, useEffect, useRef, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  saveTransactions, loadDarkMode, saveDarkMode,
  exportCsv, computeStats, type TransactionRow,
} from "@/lib/storage";
import { PRODUCT_CATALOG, parseSerialLine, lcdPad, type LcdState } from "@/lib/serial";
import {
  applyRawEventToTransaction,
  buildCompletedTransactionsFromEvents,
  countPirEntries,
  mergeCompletedTransactions,
  type RawTransactionEvent,
  type TransactionDraft,
} from "@/lib/transaction-bridge";
import {
  useStateMachine, applyTrigger, eventToTrigger, SM_STATES,
  type SmState,
} from "@/lib/stateMachine";
import { useSocket } from "@/hooks/useSocket";

// Web Serial API type declarations
declare global {
  interface Navigator {
    serial: {
      requestPort(): Promise<SerialPort>;
    };
  }
  
  interface SerialPort {
    open(options: { baudRate: number }): Promise<void>;
    close(): Promise<void>;
    readable: ReadableStream<Uint8Array> | null;
    writable: WritableStream<Uint8Array> | null;
  }
}

type ConnectionStatus = "disconnected" | "connected" | "connecting";

// ── LCD Simulator ─────────────────────────────────────────────────────────

const LCD_THEMES: Record<string, { bg: string; text: string; border: string; glow: string }> = {
  ready:   { bg: "#1E3A8A", text: "#A5D8FF", border: "#1E40AF", glow: "#3B82F6" },
  entry:   { bg: "#78350F", text: "#FDE68A", border: "#92400E", glow: "#FBBF24" },
  payment: { bg: "#7C2D12", text: "#FDBA74", border: "#9A3412", glow: "#F59E0B" },
  ok:      { bg: "#064E3B", text: "#6EE7B7", border: "#059669", glow: "#10B981" },
  error:   { bg: "#7F1D1D", text: "#FCA5A5", border: "#991B1B", glow: "#EF4444" },
  info:    { bg: "#1E293B", text: "#CBD5E1", border: "#334155", glow: "#64748B" },
};

const SM_STATE_LABEL: Record<SmState, string> = {
  READY:   "HonestPay Ready",
  ENTERED: "Customer Entered",
  PAY:     "Awaiting Payment",
  OK:      "Payment OK ✓",
  ERROR:   "Insufficient ✗",
};

const SM_STATE_COLOR: Record<SmState, string> = {
  READY:   "bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200",
  ENTERED: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/60 dark:text-yellow-200",
  PAY:     "bg-orange-100 text-orange-800 dark:bg-orange-900/60 dark:text-orange-200",
  OK:      "bg-green-100 text-green-800 dark:bg-green-900/60 dark:text-green-200",
  ERROR:   "bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200",
};

function LcdSimulator({ state, smState }: { state: LcdState; smState: SmState }) {
  const theme = LCD_THEMES[state.theme] ?? LCD_THEMES.ready;
  const cfg = SM_STATES[smState];
  const hasTimer = cfg.autoResetMs > 0;

  return (
    <div
      className="relative rounded-2xl p-4 shadow-2xl select-none"
      style={{
        background: "linear-gradient(145deg, #3a3a3a, #222)",
        border: "3px solid #555",
        boxShadow: `0 0 32px 6px ${theme.glow}55, 0 6px 24px rgba(0,0,0,0.6)`,
        transition: "box-shadow 0.5s ease",
      }}
    >
      {/* Top bezel label */}
      <div className="flex items-center justify-between mb-2 px-1">
        <span className="text-xs font-bold tracking-widest uppercase" style={{ color: "#777" }}>
          Arduino LCD 16×2
        </span>
        {/* State pill */}
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${SM_STATE_COLOR[smState]}`}>
          {SM_STATE_LABEL[smState]}
        </span>
      </div>

      {/* LCD screen body */}
      <div
        className="rounded-lg p-3 relative overflow-hidden"
        style={{
          background: theme.bg,
          border: `2px solid ${theme.border}`,
          boxShadow: `inset 0 3px 10px rgba(0,0,0,0.6), 0 0 16px ${theme.glow}77`,
          transition: "background 0.4s ease, border-color 0.4s ease, box-shadow 0.4s ease",
          minHeight: "64px",
        }}
      >
        {/* Scanline effect */}
        <div className="absolute inset-0 pointer-events-none"
          style={{
            background: `repeating-linear-gradient(0deg, transparent, transparent 4px, rgba(0,0,0,0.06) 4px, rgba(0,0,0,0.06) 5px)`,
          }}
        />
        <LcdLine text={state.line1} color={theme.text} />
        <div style={{ borderTop: `1px solid ${theme.border}55`, margin: "3px 0" }} />
        <LcdLine text={state.line2} color={theme.text} />
      </div>

      {/* Timer bar — shown for OK/ERROR auto-reset states */}
      {hasTimer && (
        <div className="mt-2 h-1 rounded-full overflow-hidden bg-black/30">
          <div
            className="h-full rounded-full"
            style={{
              background: theme.glow,
              animation: `shrink ${cfg.autoResetMs}ms linear forwards`,
              boxShadow: `0 0 6px ${theme.glow}`,
            }}
          />
        </div>
      )}

      {/* Bottom LEDs */}
      <div className="flex items-center gap-3 mt-2.5 px-1">
        {[
          { label: "PWR", color: "#10B981", on: true },
          { label: "RX",  color: theme.glow, on: smState !== "READY" },
          { label: "TX",  color: theme.glow, on: smState === "OK" || smState === "ERROR" },
        ].map(({ label, color, on }) => (
          <div key={label} className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full transition-all duration-300"
              style={{ background: on ? color : "#333", boxShadow: on ? `0 0 6px ${color}` : "none" }} />
            <span className="text-xs" style={{ color: "#666" }}>{label}</span>
          </div>
        ))}
        {hasTimer && (
          <span className="ml-auto text-xs font-mono" style={{ color: theme.glow }}>
            auto-reset…
          </span>
        )}
      </div>
    </div>
  );
}

function LcdLine({ text, color }: { text: string; color: string }) {
  const chars = Array.from(text.padEnd(16, " ").slice(0, 16));
  return (
    <div className="flex" style={{ letterSpacing: "0.06em" }}>
      {chars.map((ch, i) => (
        <span key={i} style={{
          color,
          fontFamily: "'Courier New', 'Lucida Console', monospace",
          fontSize: "15px",
          fontWeight: "bold",
          minWidth: "9px",
          textAlign: "center",
          textShadow: `0 0 8px ${color}`,
          transition: "color 0.4s ease, text-shadow 0.4s ease",
        }}>
          {ch === " " ? "\u00A0" : ch}
        </span>
      ))}
    </div>
  );
}

// ── State machine flow visual ─────────────────────────────────────────────

const FLOW_STEPS: { id: SmState; icon: string; label: string; sub: string }[] = [
  { id: "READY",   icon: "🏪", label: "Ready",    sub: "Waiting for customer" },
  { id: "ENTERED", icon: "👤", label: "Entered",   sub: "PIR detected" },
  { id: "PAY",     icon: "💰", label: "Pay",       sub: "Product removed" },
  { id: "OK",      icon: "✅", label: "OK",        sub: "Auto-reset 3s" },
  { id: "ERROR",   icon: "❌", label: "Add Coins", sub: "Retry in 5s" },
];

function FlowIndicator({ current }: { current: SmState }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {FLOW_STEPS.map((step, i) => {
        const isActive = step.id === current;
        const isPast = FLOW_STEPS.findIndex((s) => s.id === current) > i;
        return (
          <div key={step.id} className="flex items-center gap-1">
            <div className={`flex flex-col items-center transition-all duration-300 ${isActive ? "scale-110" : ""}`}>
              <div className={`w-9 h-9 rounded-full flex items-center justify-center text-base border-2 transition-all duration-300 ${
                isActive
                  ? "border-primary bg-primary text-white shadow-lg shadow-primary/40"
                  : isPast
                  ? "border-green-400 bg-green-50 dark:bg-green-900/30"
                  : "border-border bg-card text-muted-foreground"
              }`}>
                {isPast ? "✓" : step.icon}
              </div>
              <span className={`text-xs mt-0.5 font-semibold ${isActive ? "text-primary" : "text-muted-foreground"}`}>
                {step.label}
              </span>
            </div>
            {i < FLOW_STEPS.length - 1 && (
              <div className={`w-6 h-0.5 mb-4 rounded transition-all duration-300 ${isPast || isActive ? "bg-green-400" : "bg-border"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Demo runner ───────────────────────────────────────────────────────────

const DEMO_SCRIPT = [
  { line: "HonestPay Ready",              delay: 800  },
  { line: "Entry: 201",                   delay: 1500 },
  { line: "Customer Entered",             delay: 1000 },
  { line: `Product Removed. Pay ${PRODUCT_CATALOG.PHP5.label}.`, delay: 2000 },
  { line: `Pay ${PRODUCT_CATALOG.PHP5.label}`, delay: 1500 },
  { line: "Coin Detected: 7.3g -> PHP5 ACCEPTED", delay: 900 },
  { line: "Inserted: PHP5",               delay: 700 },
  { line: "Remaining: PHP0",              delay: 700 },
  { line: "Dispensing Product...",        delay: 900 },
  { line: "Payment OK",                   delay: 4000 }, // wait for 3s auto-reset
  { line: "HonestPay Ready",              delay: 1000 },
  { line: "Entry: 202",                   delay: 1500 },
  { line: `Product Removed. Pay ${PRODUCT_CATALOG.PHP10.label}.`, delay: 1500 },
  { line: `Pay ${PRODUCT_CATALOG.PHP10.label}`, delay: 1000 },
  { line: "Coin Detected: 7.3g -> PHP5 ACCEPTED", delay: 900 },
  { line: "Inserted: PHP5",               delay: 700 },
  { line: "Remaining: PHP5",              delay: 700 },
  { line: "Add More Coins",              delay: 6000 }, // wait for 5s retry
  { line: "Coin Detected: 7.9g -> INVALID COIN", delay: 900 },
  { line: "Inserted: PHP5",               delay: 700 },
  { line: "Remaining: PHP5",              delay: 700 },
  { line: "Add More Coins",              delay: 1500 },
  { line: "Coin Detected: 8.8g -> PHP10 ACCEPTED", delay: 900 },
  { line: "Inserted: PHP15",              delay: 700 },
  { line: "Remaining: PHP0",              delay: 700 },
  { line: "Dispensing Product...",        delay: 900 },
  { line: "Payment OK",                   delay: 1200 },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function formatTimestamp(ts: string) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── Main Dashboard ────────────────────────────────────────────────────────

export default function Dashboard() {
  const [darkMode, setDarkMode] = useState(loadDarkMode);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [localPirCount, setLocalPirCount] = useState(0);
  const [livePirCount, setLivePirCount] = useState<number | null>(null);
  const [counterStatus, setCounterStatus] = useState("loading");
  const [connStatus, setConnStatus] = useState<ConnectionStatus>("disconnected");
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualLine, setManualLine] = useState("");
  const [recentPirFlash, setRecentPirFlash] = useState(false);
  const [demoRunning, setDemoRunning] = useState(false);
  const [serialLcdState, setSerialLcdState] = useState<LcdState | null>(null);
  const [serialDebugLines, setSerialDebugLines] = useState<string[]>([]);

  const portRef = useRef<SerialPort | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const demoTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const ongoingTransactionRef = useRef<TransactionDraft | null>(null);

  const sm = useStateMachine();
  const effectiveLcdState = serialLcdState ?? sm.lcdState;

  // ── Dark mode ──
  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    saveDarkMode(darkMode);
  }, [darkMode]);

  // ── Clear transaction logs on startup (fresh start) ──
  useEffect(() => {
    localStorage.removeItem("smartpay_transactions");
    setTransactions([]);
    setLocalPirCount(0);
    ongoingTransactionRef.current = null;
    console.log("[STARTUP] Transaction logs cleared");
  }, []);

  // ── Persist transactions ──
  useEffect(() => { saveTransactions(transactions); }, [transactions]);

  // ── PIR count — derived from today's "Entry" rows in the transaction log ──
  const displayedPirCount = livePirCount ?? localPirCount;

  // ── Live counter from deployed Vercel API ──
  useEffect(() => {
    let cancelled = false;

    const fetchCounter = async () => {
      try {
        const res = await fetch("/api/counter");
        const data = await res.json();

        if (cancelled) return;

        if (data && typeof data.count === "number") {
          setLivePirCount(data.count);
          setCounterStatus("live");
        } else {
          setCounterStatus("no-data");
        }
      } catch (err) {
        if (!cancelled) {
          console.debug("Failed to fetch live counter:", err);
          setCounterStatus("offline");
        }
      }
    };

    fetchCounter();
    const interval = setInterval(fetchCounter, 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // ── Fetch and poll transactions from API with Socket.io real-time support ──
  const { socket, isConnected } = useSocket();

  const fetchTransactions = useCallback(async () => {
    try {
      const r = await fetch("/api/transactions");
      const apiRows: Array<{
        id: number; timestamp: string; event: string;
        product?: string | null; paymentStatus?: string | null;
        weight?: string | null; rawLine?: string | null;
      }> = await r.json();

      if (!Array.isArray(apiRows)) return;

      const rawRows: RawTransactionEvent[] = apiRows
        .map((r) => ({
          id: String(r.id),
          timestamp: r.timestamp,
          event: r.event,
          product: r.product ?? null,
          paymentStatus: r.paymentStatus ?? null,
          weight: r.weight ?? null,
          rawLine: r.rawLine ?? null,
        }))
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      setTransactions((prev) => mergeCompletedTransactions(prev, buildCompletedTransactionsFromEvents(rawRows)));
      setLocalPirCount(countPirEntries(rawRows));
    } catch (err) {
      console.debug("Failed to fetch transactions:", err);
    }
  }, []);

  useEffect(() => {
    const resetTransactions = async () => {
      try {
        await fetch("/api/transactions", { method: "DELETE" });
      } catch (err) {
        console.debug("Failed to clear transactions on startup:", err);
      }
    };

    resetTransactions().finally(() => {
      fetchTransactions();
    });
  }, [fetchTransactions]);

  useEffect(() => {
    fetchTransactions();
    const interval = setInterval(fetchTransactions, isConnected ? 1000 : 3000);
    return () => clearInterval(interval);
  }, [fetchTransactions, isConnected, socket]);

  // ── Core line handler (serial or manual) ──
  const handleLine = useCallback((rawLine: string) => {
    const trimmed = rawLine.trim();
    if (trimmed) {
      setSerialDebugLines((prev) => [trimmed, ...prev].slice(0, 40));
    }

    const parsed = parseSerialLine(rawLine);
    if (!parsed) return;

    if (parsed.lcdState) {
      setSerialLcdState(parsed.lcdState);
    }

    sm.ping();

    const eventTimestamp = new Date().toISOString();

    // Apply to state machine
    const trigger = eventToTrigger(parsed.event);
    applyTrigger(trigger, sm.state, sm.transition, {
      product: parsed.product ?? undefined,
      weight: parsed.weight ?? undefined,
    });

    // PIR counter increment
    if (parsed.isPirEntry) {
      setLocalPirCount((count) => count + 1);
      setRecentPirFlash(true);
      setTimeout(() => setRecentPirFlash(false), 1500);
    }

    if (parsed.isLogEntry) {
      fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timestamp: eventTimestamp,
          event: parsed.event,
          product: parsed.product,
          paymentStatus: parsed.paymentStatus,
          weight: parsed.weight,
          rawLine: parsed.rawLine,
        }),
      }).catch((err) => {
        console.debug("Failed to persist serial event:", err);
      });
    }

    const next = applyRawEventToTransaction(ongoingTransactionRef.current, {
      timestamp: eventTimestamp,
      event: parsed.event,
      product: parsed.product,
      weight: parsed.weight,
    });

    ongoingTransactionRef.current = next.draft;

    if (next.completed) {
      setTransactions((prev) => mergeCompletedTransactions(prev, [next.completed!]));
    }
  }, [sm]);

  // ── Web Serial ──
  const connectSerial = useCallback(async () => {
    if (!("serial" in navigator)) {
      alert("Web Serial API not supported. Use Chrome or Edge on desktop.");
      return;
    }
    try {
      setConnStatus("connecting");
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 9600 });
      portRef.current = port;
      setConnStatus("connected");
      const decoder = new TextDecoderStream();
      if (port.readable) {
        port.readable.pipeTo(decoder.writable as any);
      }
      const reader = decoder.readable.getReader();
      readerRef.current = reader as unknown as ReadableStreamDefaultReader<Uint8Array>;
      let buf = "";
      (async () => {
        try {
          while (true) {
            const { value, done } = await (reader as ReadableStreamDefaultReader<string>).read();
            if (done) break;
            buf += value;
            const lines = buf.split("\n");
            buf = lines.pop() ?? "";
            for (const line of lines) handleLine(line);
          }
        } catch { /* port closed */ }
        setConnStatus("disconnected");
        portRef.current = null;
      })();
    } catch {
      setConnStatus("disconnected");
    }
  }, [handleLine]);

  const disconnectSerial = useCallback(async () => {
    try { readerRef.current?.cancel(); await portRef.current?.close(); } catch { /* ignore */ }
    portRef.current = null;
    setConnStatus("disconnected");
  }, []);

  // ── Demo mode ──
  const runDemo = useCallback(() => {
    if (demoRunning) return;
    setDemoRunning(true);
    let elapsed = 0;
    for (const step of DEMO_SCRIPT) {
      const t = setTimeout(() => handleLine(step.line), elapsed);
      demoTimers.current.push(t);
      elapsed += step.delay;
    }
    const done = setTimeout(() => setDemoRunning(false), elapsed + 500);
    demoTimers.current.push(done);
  }, [demoRunning, handleLine]);

  const stopDemo = useCallback(() => {
    demoTimers.current.forEach(clearTimeout);
    demoTimers.current = [];
    setDemoRunning(false);
  }, []);

  // ── Manual entry ──
  const handleManualAdd = () => {
    if (!manualLine.trim()) return;
    handleLine(manualLine);
    setManualLine("");
    setShowManualEntry(false);
  };

  const stats = computeStats(transactions);

  const connBadge = connStatus === "connected"
    ? "bg-green-500/20 text-green-300 border border-green-500/30"
    : connStatus === "connecting"
    ? "bg-yellow-500/20 text-yellow-300 border border-yellow-500/30"
    : "bg-white/10 text-blue-200 border border-white/10";

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <>
      {/* Keyframe for the timer shrink bar */}
      <style>{`
        @keyframes shrink {
          from { width: 100%; }
          to   { width: 0%; }
        }
      `}</style>

      <div className="min-h-screen bg-background text-foreground">

        {/* ── Header ── */}
        <header className="bg-primary text-white shadow-lg sticky top-0 z-20">
          <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="w-8 h-8 bg-white/15 rounded-lg flex items-center justify-center shrink-0 text-lg">🏪</div>
              <div className="min-w-0">
                <h1 className="font-bold text-base leading-tight">HonestPay Dashboard</h1>
                <p className="text-blue-200 text-xs">Honest Store Monitor</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* PIR counter */}
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold transition-all duration-300 ${recentPirFlash ? "bg-green-500/30 text-green-200 scale-105" : "bg-white/10 text-blue-100"}`}>
                <span>👁</span>
                <span>Entries: {displayedPirCount}</span>
                {recentPirFlash && <span className="text-green-300 animate-bounce">↑</span>}
              </div>
              {/* Revenue */}
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold bg-yellow-500/20 text-yellow-200">
                <span>💰</span>
                <span>PHP {stats.totalRevenue}</span>
              </div>
              {/* Connection */}
              <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${connBadge}`}>
                {connStatus === "connected" ? "🟢 Live" : connStatus === "connecting" ? "🟡 …" : "⚫ Off"}
              </span>
              <button onClick={() => setDarkMode((d) => !d)}
                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-base"
                title="Toggle dark mode">
                {darkMode ? "☀️" : "🌙"}
              </button>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 py-5 space-y-5">

          {/* ── Controls ── */}
          <div className="flex flex-wrap gap-2 items-center">
            {connStatus === "disconnected"
              ? <button onClick={connectSerial} className="px-4 py-2 bg-primary text-white font-semibold rounded-lg shadow hover:bg-blue-800 transition-colors text-sm">🔌 Connect Arduino</button>
              : connStatus === "connected"
              ? <button onClick={disconnectSerial} className="px-4 py-2 bg-red-600 text-white font-semibold rounded-lg shadow hover:bg-red-700 transition-colors text-sm">⏹ Disconnect</button>
              : <button disabled className="px-4 py-2 bg-gray-400 text-white font-semibold rounded-lg cursor-not-allowed text-sm">Connecting…</button>}
            <button onClick={() => setShowManualEntry((v) => !v)}
              className="px-4 py-2 bg-secondary text-secondary-foreground font-semibold rounded-lg border border-border hover:bg-muted transition-colors text-sm">
              ✏️ Manual Entry
            </button>
            {!demoRunning
              ? <button onClick={runDemo}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white font-semibold rounded-lg shadow transition-colors text-sm">
                  🎬 Run Demo Flow
                </button>
              : <button onClick={stopDemo}
                  className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white font-semibold rounded-lg shadow transition-colors text-sm animate-pulse">
                  ⏸ Stop Demo
                </button>}
            <button onClick={() => exportCsv(transactions)}
              className="px-4 py-2 bg-accent text-accent-foreground font-semibold rounded-lg shadow hover:opacity-90 transition-opacity text-sm">
              📥 Export CSV
            </button>
            {transactions.length > 0 && (
              <button onClick={async () => {
                if (!confirm("Clear all local transactions and reset remote store?")) return;
                try {
                  // Clear remote store if available
                  await fetch('/api/transactions', { method: 'DELETE' });
                } catch (e) {
                  console.debug('Failed to clear remote store:', e);
                }
                // Clear local storage and PIR counter
                localStorage.removeItem('smartpay_transactions');
                localStorage.removeItem('smartpay_pir_counter');
                ongoingTransactionRef.current = null;
                setTransactions([]);
                setLocalPirCount(0);
                setLivePirCount(null);
                console.log('[ACTION] Cleared local and remote transactions');
              }}
                className="px-4 py-2 text-sm text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 transition-colors">
                🗑 Clear Log
              </button>
            )}
          </div>

          {/* Manual Entry Panel */}
          {showManualEntry && (
            <div className="bg-card border border-card-border rounded-xl p-4 shadow-sm">
              <h3 className="font-semibold mb-2 text-xs text-muted-foreground uppercase tracking-wider">
                Manual Serial Line — updates LCD + state machine
              </h3>
              <div className="flex gap-2">
                <input type="text" value={manualLine}
                  onChange={(e) => setManualLine(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleManualAdd()}
                  placeholder='"Entry: 124"  "Product Removed. Pay Product One (PHP5)."  "Inserted: PHP5"  "Remaining: PHP0"  "Payment OK"'
                  className="flex-1 px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                <button onClick={handleManualAdd}
                  className="px-4 py-2 bg-primary text-white rounded-lg font-semibold text-sm hover:bg-blue-800">
                  Send
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {[
                  "HonestPay Ready", "Entry: 124", "Customer Entered",
                  `Product Removed. Pay ${PRODUCT_CATALOG.PHP5.label}.`, `Pay ${PRODUCT_CATALOG.PHP5.label}`,
                  `Product Removed. Pay ${PRODUCT_CATALOG.PHP10.label}.`, `Pay ${PRODUCT_CATALOG.PHP10.label}`,
                  "Coin Detected: 7.3g -> PHP5 ACCEPTED", "Coin Detected: 8.8g -> PHP10 ACCEPTED",
                  "Coin Detected: 7.9g -> INVALID COIN",
                  "Inserted: PHP5", "Remaining: PHP5", "Remaining: PHP0",
                  "Dispensing Product...", "Payment OK", "Add More Coins", "Customer Left",
                ].map((s, qi) => (
                  <button key={qi} onClick={() => handleLine(s)}
                    className="px-2 py-1 bg-muted hover:bg-muted/60 border border-border rounded text-xs font-mono transition-colors">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── LCD + Flow Indicator ── */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
            {/* LCD — takes 2/5 */}
            <div className="lg:col-span-2">
              <LcdSimulator state={effectiveLcdState} smState={sm.state} />
            </div>

            {/* Right column — flow + PIR + stats */}
            <div className="lg:col-span-3 space-y-4">
              {/* Customer Flow */}
              <div className="bg-card border border-card-border rounded-xl p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-sm">Customer Flow</h3>
                  <span className="text-xs text-muted-foreground">
                    Idle reset: 30s • OK: 3s • Error: 5s
                  </span>
                </div>
                <FlowIndicator current={sm.state} />
              </div>

              {/* PIR counter prominent */}
              <div className={`bg-card border border-card-border rounded-xl p-4 shadow-sm transition-all duration-300 ${recentPirFlash ? "ring-2 ring-green-400" : ""}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">👁</span>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">PIR Entries Today</span>
                  </div>
                  {recentPirFlash && <span className="text-green-500 font-bold text-lg animate-bounce">+1 ↑</span>}
                </div>
                <div className="flex items-end gap-3 mt-1">
                  <span className="text-4xl font-extrabold text-primary dark:text-blue-400">{displayedPirCount}</span>
                  <span className="text-sm text-muted-foreground mb-1">customers today</span>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Live source: {counterStatus === "live" ? "/api/counter" : counterStatus === "loading" ? "loading..." : "transaction fallback"}
                </div>
              </div>

              {/* Live counter API card */}
              <div className="bg-card border border-card-border rounded-xl p-4 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">📡</span>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Live Counter API</span>
                  </div>
                  <span className={`text-xs font-semibold px-2 py-1 rounded-full ${counterStatus === "live" ? "bg-green-100 text-green-700 dark:bg-green-900/60 dark:text-green-200" : counterStatus === "loading" ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/60 dark:text-yellow-200" : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"}`}>
                    {counterStatus === "live" ? "live" : counterStatus === "loading" ? "loading" : "fallback"}
                  </span>
                </div>
                <div className="flex items-end gap-3">
                  <span className="text-3xl font-extrabold text-primary dark:text-blue-400">{displayedPirCount}</span>
                  <span className="text-sm text-muted-foreground mb-1">current count</span>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Source: {counterStatus === "live" ? "/api/counter" : "transaction fallback"}
                </div>
              </div>
            </div>
          </div>

          {/* ── Secondary Stat Cards ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard icon="🧾" label="Total Transactions"  value={String(stats.todayCount)} />
            <StatCard icon="✅" label="Successful"  value={String(stats.successCount)} valueClass="text-green-600 dark:text-green-400" />
            <StatCard icon="❌" label="Failed"  value={String(stats.failureCount)} valueClass="text-red-600 dark:text-red-400" />
            <StatCard
              icon="📊"
              label="Success Rate"
              value={stats.successRate !== null ? `${stats.successRate}%` : "—"}
              valueClass={
                stats.successRate === null
                  ? "text-muted-foreground"
                  : stats.successRate >= 80
                  ? "text-green-600 dark:text-green-400"
                  : stats.successRate >= 50
                  ? "text-yellow-600 dark:text-yellow-400"
                  : "text-red-500"
              }
            />
          </div>

          {/* ── Bar Chart ── */}
          <div className="bg-card border border-card-border rounded-xl shadow-sm p-5">
            <h2 className="font-bold text-base mb-3">Transactions per Hour (Today)</h2>
            {stats.hourlyData.some((d) => d.count > 0) ? (
              <ResponsiveContainer width="100%" height={150}>
                <BarChart data={stats.hourlyData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="hour" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} />
                  <Tooltip contentStyle={{
                    background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
                    borderRadius: "8px", color: "hsl(var(--foreground))", fontSize: 12,
                  }} />
                  <Bar dataKey="count" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-28 flex items-center justify-center text-muted-foreground text-sm">No transactions yet today</div>
            )}
          </div>

          {/* ── Transaction Log ── */}
          <div className="bg-card border border-card-border rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between">
              <h2 className="font-bold text-base">Completed Transactions</h2>
              <span className="text-xs text-muted-foreground">{transactions.length} total</span>
            </div>
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-muted/80 backdrop-blur">
                    {["Timestamp", "Product", "Price (PHP)", "Inserted (PHP)", "Status", "Reason"].map((h) => (
                      <th key={h} className="text-left px-4 py-2 font-semibold text-muted-foreground text-xs whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {transactions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-muted-foreground">
                        <div className="text-3xl mb-2">📡</div>
                        <div>No completed transactions yet.</div>
                        <div className="text-xs mt-1">Connect Arduino, run the demo, or use Manual Entry.</div>
                      </td>
                    </tr>
                  ) : transactions.map((row) => (
                    <tr key={row.id} className={`hover:bg-muted/30 transition-colors ${row.status === "SUCCESS" ? "bg-green-50/5 dark:bg-green-950/10" : "bg-red-50/5 dark:bg-red-950/10"}`}>
                      <td className="px-4 py-2 text-muted-foreground font-mono text-xs whitespace-nowrap">{formatTimestamp(row.timestamp)}</td>
                      <td className="px-4 py-2">
                        <span className="font-semibold text-yellow-700 dark:text-yellow-400 text-xs">{row.product}</span>
                      </td>
                      <td className="px-4 py-2 font-mono font-semibold">PHP {row.price}</td>
                      <td className="px-4 py-2 font-mono font-semibold">PHP {row.inserted}</td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${
                          row.status === "SUCCESS"
                            ? "bg-green-100 text-green-800 dark:bg-green-900/60 dark:text-green-200"
                            : "bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200"
                        }`}>
                          {row.status}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                          row.reason === "VALID"
                            ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                            : row.reason === "INSUFFICIENT"
                            ? "bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300"
                            : "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                        }`}>
                          {row.reason}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Raw Serial Debug ── */}
          <div className="bg-card border border-card-border rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between">
              <h2 className="font-bold text-base">Raw Serial Debug</h2>
              <span className="text-xs text-muted-foreground">latest {serialDebugLines.length} lines</span>
            </div>
            <div className="max-h-56 overflow-y-auto bg-muted/20">
              {serialDebugLines.length === 0 ? (
                <div className="px-5 py-8 text-sm text-muted-foreground">
                  No raw serial lines yet. Connect HC-05 and trigger the Arduino output.
                </div>
              ) : (
                <ul className="divide-y divide-border text-xs font-mono">
                  {serialDebugLines.map((line, index) => (
                    <li key={`${line}-${index}`} className="px-5 py-2 whitespace-pre-wrap wrap-break-word">
                      {line}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* ── Arduino Guide ── */}
          <ArduinoGuide />

          <footer className="text-center text-xs text-muted-foreground py-3">
            HonestPay Store Dashboard · Data stored locally &amp; synced · No login required
          </footer>
        </main>
      </div>
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

function StatCard({ icon, label, value, valueClass, sub }: {
  icon: string; label: string; value: string; valueClass?: string; sub?: string;
}) {
  return (
    <div className="bg-card border border-card-border rounded-xl p-4 shadow-sm">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-base">{icon}</span>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</span>
      </div>
      <div className={`text-2xl font-bold ${valueClass ?? "text-foreground"}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function ArduinoGuide() {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-card border border-card-border rounded-xl shadow-sm overflow-hidden">
      <button onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold hover:bg-muted/40 transition-colors">
        <span>📖 How to Connect Arduino + Expected Serial Format</span>
        <span className="text-muted-foreground">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-5 pb-5 text-sm text-muted-foreground space-y-3 border-t border-border pt-4">
          <p className="font-semibold text-foreground">Connection steps:</p>
          <ol className="list-decimal list-inside space-y-1.5">
            <li>Upload SmartPay sketch (baud rate <code className="bg-muted px-1 rounded">9600</code>)</li>
            <li>Connect via USB. Open dashboard in <strong>Chrome / Edge</strong>.</li>
            <li>Click <strong>Connect Arduino</strong> → select the COM port.</li>
            <li>LCD + log update live as data arrives.</li>
          </ol>
          <p className="font-semibold text-foreground mt-3">Arduino sketch snippet (add after each transaction):</p>
          <div className="bg-muted rounded-lg p-3 font-mono text-xs space-y-0.5">
            {[
              "lcd.clear();",
              'lcd.print("HonestPay Ready");',
              'Serial.println("HonestPay Ready");',
              "delay(500);",
            ].map((l) => <div key={l}>{l}</div>)}
          </div>
          <p className="font-semibold text-foreground mt-3">Full expected serial sequence:</p>
          <div className="bg-muted rounded-lg p-3 font-mono text-xs space-y-1">
            {[
              ["HonestPay Ready",             "→ blue LCD, reset state"],
              ["Entry: 124",                  "→ yellow LCD, PIR +1"],
              ["Customer Entered",            "→ yellow LCD"],
              [`Product Removed. Pay ${PRODUCT_CATALOG.PHP5.label}.`,  "→ orange LCD, log entry"],
              [`Pay ${PRODUCT_CATALOG.PHP5.label}`,                    "→ orange LCD, awaiting"],
              [`Product Removed. Pay ${PRODUCT_CATALOG.PHP10.label}.`,  "→ orange LCD, log entry"],
              [`Pay ${PRODUCT_CATALOG.PHP10.label}`,                    "→ orange LCD, awaiting"],
              ["Coin Detected: 7.3g -> PHP5 ACCEPTED", "→ coin classified as ₱5"],
              ["Coin Detected: 8.8g -> PHP10 ACCEPTED", "→ coin classified as ₱10"],
              ["Coin Detected: 7.9g -> INVALID COIN", "→ rejected, not counted"],
              ["Inserted: PHP5",               "→ running total paid"],
              ["Remaining: PHP5",              "→ amount left to pay"],
              ["Remaining: PHP0",              "→ fully paid"],
              ["Dispensing Product...",        "→ payment complete"],
              ["Payment OK",                   "→ success state + stats"],
              ["Add More Coins",              "→ red LCD"],
              ["Customer Left",               "→ blue LCD, ready"],
            ].map(([line, note]) => (
              <div key={line} className="flex gap-2">
                <span className="text-foreground min-w-0 shrink-0">{line}</span>
                <span className="text-muted-foreground/70">{note}</span>
              </div>
            ))}
          </div>
          <p className="text-xs mt-2">
            <strong>Bluetooth:</strong> HC-05/HC-06 → virtual COM port → same Connect dialog.{" "}
            <strong>No hardware?</strong> Use <strong>Run Demo Flow</strong> above for a full automated walkthrough.
          </p>
        </div>
      )}
    </div>
  );
}
