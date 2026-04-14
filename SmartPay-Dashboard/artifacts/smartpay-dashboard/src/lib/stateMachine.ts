import { useReducer, useEffect, useRef, useCallback } from "react";
import { lcdPad, type LcdState } from "./serial";

// ── State definitions ────────────────────────────────────────────────────

export type SmState = "READY" | "ENTERED" | "PAY" | "OK" | "ERROR";

export interface SmConfig {
  id: SmState;
  line1: (ctx: SmContext) => string;
  line2: (ctx: SmContext, countdown?: number) => string;
  theme: LcdState["theme"];
  /** ms until auto-transition. 0 = no auto-reset */
  autoResetMs: number;
  /** Which state to go to after autoReset */
  autoResetTarget: SmState;
  /** ms of idle before resetting to READY. 0 = use global default */
  idleMs: number;
}

export interface SmContext {
  product: string | null;
  weight: string | null;
}

export const SM_STATES: Record<SmState, SmConfig> = {
  READY: {
    id: "READY",
    line1: () => lcdPad("** SmartPay **"),
    line2: () => lcdPad("    Ready \u2665"),
    theme: "ready",
    autoResetMs: 0,
    autoResetTarget: "READY",
    idleMs: 0,
  },
  ENTERED: {
    id: "ENTERED",
    line1: () => lcdPad("Customer Entered"),
    line2: () => lcdPad("  Please wait..."),
    theme: "entry",
    autoResetMs: 0,
    autoResetTarget: "READY",
    idleMs: 30_000,
  },
  PAY: {
    id: "PAY",
    line1: (ctx) => lcdPad(`Insert: ${ctx.product ?? "coins"}`),
    line2: (ctx) => lcdPad(`  Pay ${ctx.product ?? "PHP?"}`),
    theme: "payment",
    autoResetMs: 0,
    autoResetTarget: "READY",
    idleMs: 30_000,
  },
  OK: {
    id: "OK",
    line1: () => lcdPad("Payment OK! \u2713"),
    line2: (_ctx, cd) => lcdPad(cd !== undefined ? `  Thank you! ${cd}s` : "  Thank you! :)"),
    theme: "ok",
    autoResetMs: 3_000,
    autoResetTarget: "READY",
    idleMs: 0,
  },
  ERROR: {
    id: "ERROR",
    line1: () => lcdPad("Insufficient! \u2717"),
    line2: (_ctx, cd) => lcdPad(cd !== undefined ? `Add coins... ${cd}s` : "Add More Coins"),
    theme: "error",
    autoResetMs: 5_000,
    autoResetTarget: "PAY",
    idleMs: 0,
  },
};

const GLOBAL_IDLE_MS = 30_000;

// ── Reducer ──────────────────────────────────────────────────────────────

interface SmStoreState {
  state: SmState;
  ctx: SmContext;
  countdown: number | null; // seconds shown in LCD
  lastActivity: number;
}

type SmAction =
  | { type: "TRANSITION"; to: SmState; ctx?: Partial<SmContext> }
  | { type: "TICK" }
  | { type: "IDLE_RESET" };

function reducer(store: SmStoreState, action: SmAction): SmStoreState {
  switch (action.type) {
    case "TRANSITION": {
      const cfg = SM_STATES[action.to];
      const countdown = cfg.autoResetMs > 0 ? Math.ceil(cfg.autoResetMs / 1000) : null;
      return {
        state: action.to,
        ctx: { ...store.ctx, ...(action.ctx ?? {}) },
        countdown,
        lastActivity: Date.now(),
      };
    }
    case "TICK": {
      if (store.countdown === null || store.countdown <= 1) return store;
      return { ...store, countdown: store.countdown - 1 };
    }
    case "IDLE_RESET":
      return { ...reducer(store, { type: "TRANSITION", to: "READY" }), lastActivity: Date.now() };
    default:
      return store;
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────

export interface UseStateMachineReturn {
  state: SmState;
  ctx: SmContext;
  lcdState: LcdState;
  transition: (to: SmState, ctx?: Partial<SmContext>) => void;
  /** Call on any user/serial activity to reset idle timer */
  ping: () => void;
}

export function useStateMachine(): UseStateMachineReturn {
  const [store, dispatch] = useReducer(reducer, {
    state: "READY",
    ctx: { product: null, weight: null },
    countdown: null,
    lastActivity: Date.now(),
  });

  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = () => {
    if (autoTimerRef.current) { clearTimeout(autoTimerRef.current); autoTimerRef.current = null; }
    if (tickTimerRef.current) { clearInterval(tickTimerRef.current); tickTimerRef.current = null; }
    if (idleTimerRef.current) { clearTimeout(idleTimerRef.current); idleTimerRef.current = null; }
  };

  // Whenever state changes, set up timers
  useEffect(() => {
    clearTimers();
    const cfg = SM_STATES[store.state];

    // Auto-reset timer (OK → READY after 3s, ERROR → PAY after 5s)
    if (cfg.autoResetMs > 0) {
      autoTimerRef.current = setTimeout(() => {
        dispatch({ type: "TRANSITION", to: cfg.autoResetTarget });
      }, cfg.autoResetMs);

      // Countdown tick every second
      tickTimerRef.current = setInterval(() => {
        dispatch({ type: "TICK" });
      }, 1_000);
    }

    // Idle timeout
    const idleMs = cfg.idleMs > 0 ? cfg.idleMs : store.state === "READY" ? 0 : GLOBAL_IDLE_MS;
    if (idleMs > 0) {
      idleTimerRef.current = setTimeout(() => {
        dispatch({ type: "IDLE_RESET" });
      }, idleMs);
    }

    return clearTimers;
  }, [store.state]);

  const transition = useCallback((to: SmState, ctx?: Partial<SmContext>) => {
    dispatch({ type: "TRANSITION", to, ctx });
  }, []);

  const ping = useCallback(() => {
    // Reset idle timer without changing state — easiest: re-dispatch current state
    dispatch({ type: "TRANSITION", to: store.state });
  }, [store.state]);

  // Build LCD state from current state + countdown
  const cfg = SM_STATES[store.state];
  const lcdState: LcdState = {
    line1: cfg.line1(store.ctx),
    line2: cfg.line2(store.ctx, store.countdown ?? undefined),
    theme: cfg.theme,
  };

  return { state: store.state, ctx: store.ctx, lcdState, transition, ping };
}

// ── Serial → State mapping ───────────────────────────────────────────────

export type SerialTrigger =
  | "READY"
  | "ENTRY"
  | "CUSTOMER_ENTERED"
  | "PRODUCT_REMOVED"
  | "PAY_PROMPT"
  | "INSERT_COINS"
  | "SENSOR_RESETTING"
  | "PLACE_ITEM"
  | "COINS_OK"
  | "COINS_FAIL"
  | "CUSTOMER_LEFT"
  | "ADD_MORE_COINS"
  | "PAYMENT_OK_EXPLICIT"
  | null;

/** Map a parsed serial event name to a state machine trigger */
export function eventToTrigger(event: string): SerialTrigger {
  const ev = event.toLowerCase();
  if (ev === "smartpay ready") return "READY";
  if (ev === "place item") return "PLACE_ITEM";
  if (ev === "entry") return "ENTRY";
  if (ev === "customer entered") return "CUSTOMER_ENTERED";
  if (ev.includes("product removed")) return "PRODUCT_REMOVED";
  if (ev.startsWith("pay ")) return "PAY_PROMPT";
  if (ev === "insert coins") return "INSERT_COINS";
  if (ev === "sensor resetting") return "SENSOR_RESETTING";
  if (ev === "payment ok") return "COINS_OK";
  if (ev === "payment incomplete") return "COINS_FAIL";
  if (ev === "customer left") return "READY";
  if (ev === "add more coins") return "ADD_MORE_COINS";
  return null;
}

/** Apply a trigger to the state machine, return true if it produced a transition */
export function applyTrigger(
  trigger: SerialTrigger,
  currentState: SmState,
  transition: (to: SmState, ctx?: Partial<SmContext>) => void,
  ctx?: Partial<SmContext>,
): boolean {
  if (!trigger) return false;

  switch (trigger) {
    case "READY":
    case "PLACE_ITEM":
      transition("READY");
      return true;
    case "ENTRY":
    case "CUSTOMER_ENTERED":
      transition("ENTERED");
      return true;
    case "PRODUCT_REMOVED":
    case "PAY_PROMPT":
    case "INSERT_COINS":
      transition("PAY", ctx);
      return true;
    case "COINS_OK":
    case "PAYMENT_OK_EXPLICIT":
    case "SENSOR_RESETTING":
      transition("OK", ctx);
      return true;
    case "COINS_FAIL":
    case "ADD_MORE_COINS":
      transition("ERROR");
      return true;
    case "CUSTOMER_LEFT":
      transition("READY");
      return true;
    default:
      return false;
  }
}
