import { useReducer, useEffect, useRef, useCallback } from "react";
import { lcdPad, type LcdState } from "./serial";

export type SmState = "IDLE" | "WAITING" | "VALIDATING" | "RESULT";
export type ResultKind = "SUCCESS" | "INVALID" | "NO_COIN";

export interface SmConfig {
  id: SmState;
  line1: (ctx: SmContext) => string;
  line2: (ctx: SmContext, countdown?: number) => string;
  theme: LcdState["theme"] | ((ctx: SmContext) => LcdState["theme"]);
  autoResetMs: number;
  autoResetTarget: SmState;
  idleMs: number;
}

export interface SmContext {
  product: string | null;
  weight: string | null;
  result: ResultKind | null;
}

export const SM_STATES: Record<SmState, SmConfig> = {
  IDLE: {
    id: "IDLE",
    line1: () => lcdPad("** HonestPay **"),
    line2: () => lcdPad("    Ready"),
    theme: "ready",
    autoResetMs: 0,
    autoResetTarget: "IDLE",
    idleMs: 0,
  },
  WAITING: {
    id: "WAITING",
    line1: () => lcdPad("Product Removed"),
    line2: (ctx) => lcdPad(ctx.product ? `  ${ctx.product.replace(/^.*\((PHP\d+)\).*$/i, "$1")}` : "Inserted Balance"),
    theme: "payment",
    autoResetMs: 0,
    autoResetTarget: "IDLE",
    idleMs: 30_000,
  },
  VALIDATING: {
    id: "VALIDATING",
    line1: () => lcdPad("Coin Detected"),
    line2: (ctx) => lcdPad(ctx.product ? `  ${ctx.product.replace(/^.*\((PHP\d+)\).*$/i, "$1")}` : (ctx.weight ? `  ${ctx.weight}` : "  Validating")),
    theme: "info",
    autoResetMs: 0,
    autoResetTarget: "IDLE",
    idleMs: 30_000,
  },
  RESULT: {
    id: "RESULT",
    line1: (ctx) => lcdPad(ctx.result === "SUCCESS" ? "Payment OK" : "Invalid Coin"),
    line2: (ctx, countdown) => {
      if (ctx.result === "SUCCESS") {
        return lcdPad(countdown !== undefined ? `Dispensing ${countdown}s` : "Dispensing...");
      }
      if (ctx.result === "NO_COIN") {
        return lcdPad(" No coin detect");
      }
      return lcdPad(" Insufficient");
    },
    theme: (ctx) => (ctx.result === "SUCCESS" ? "ok" : "error"),
    autoResetMs: 4_000,
    autoResetTarget: "IDLE",
    idleMs: 0,
  },
};

const GLOBAL_IDLE_MS = 30_000;

interface SmStoreState {
  state: SmState;
  ctx: SmContext;
  countdown: number | null;
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
      const baseCtx = action.to === "IDLE"
        ? { product: null, weight: null, result: null }
        : store.ctx;

      return {
        state: action.to,
        ctx: { ...baseCtx, ...(action.ctx ?? {}) },
        countdown,
        lastActivity: Date.now(),
      };
    }
    case "TICK": {
      if (store.countdown === null || store.countdown <= 1) return store;
      return { ...store, countdown: store.countdown - 1 };
    }
    case "IDLE_RESET":
      return { ...reducer(store, { type: "TRANSITION", to: "IDLE" }), lastActivity: Date.now() };
    default:
      return store;
  }
}

export interface UseStateMachineReturn {
  state: SmState;
  ctx: SmContext;
  lcdState: LcdState;
  transition: (to: SmState, ctx?: Partial<SmContext>) => void;
  ping: () => void;
}

export function useStateMachine(): UseStateMachineReturn {
  const [store, dispatch] = useReducer(reducer, {
    state: "IDLE",
    ctx: { product: null, weight: null, result: null },
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

  useEffect(() => {
    clearTimers();
    const cfg = SM_STATES[store.state];

    if (cfg.autoResetMs > 0) {
      autoTimerRef.current = setTimeout(() => {
        dispatch({ type: "TRANSITION", to: cfg.autoResetTarget });
      }, cfg.autoResetMs);

      tickTimerRef.current = setInterval(() => {
        dispatch({ type: "TICK" });
      }, 1_000);
    }

    const idleMs = cfg.idleMs > 0 ? cfg.idleMs : store.state === "IDLE" ? 0 : GLOBAL_IDLE_MS;
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
    dispatch({ type: "TRANSITION", to: store.state });
  }, [store.state]);

  const cfg = SM_STATES[store.state];
  const lcdState: LcdState = {
    line1: cfg.line1(store.ctx),
    line2: cfg.line2(store.ctx, store.countdown ?? undefined),
    theme: typeof cfg.theme === "function" ? cfg.theme(store.ctx) : cfg.theme,
  };

  return { state: store.state, ctx: store.ctx, lcdState, transition, ping };
}

export type SerialTrigger =
  | "IDLE"
  | "WAITING"
  | "VALIDATING"
  | "RESULT_SUCCESS"
  | "RESULT_INVALID"
  | "RESULT_NO_COIN"
  | null;

export function eventToTrigger(event: string, paymentStatus?: string | null): SerialTrigger {
  const ev = event.toLowerCase();
  const status = paymentStatus?.toLowerCase() ?? null;

  if (ev === "smartpay ready" || ev === "honestpay ready" || ev === "place item" || ev === "customer left") return "IDLE";
  if (ev.includes("product removed") || ev.startsWith("pay ") || ev === "insert coins" || ev === "inserted balance") return "WAITING";
  if (ev === "coin detected") return "VALIDATING";
  if (ev === "payment ok" || ev === "dispensing product" || ev === "sensor resetting") return "RESULT_SUCCESS";
  if (ev === "invalid coin" || ev === "payment incomplete" || ev === "add more coins") {
    return status === "no coin detected" ? "RESULT_NO_COIN" : "RESULT_INVALID";
  }

  return null;
}

export function applyTrigger(
  trigger: SerialTrigger,
  currentState: SmState,
  transition: (to: SmState, ctx?: Partial<SmContext>) => void,
  ctx?: Partial<SmContext>,
): boolean {
  if (!trigger) return false;

  switch (trigger) {
    case "IDLE":
      transition("IDLE", { product: null, weight: null, result: null });
      return true;
    case "WAITING":
      transition("WAITING", { ...ctx, result: null });
      return true;
    case "VALIDATING":
      transition("VALIDATING", { ...ctx, result: null });
      return true;
    case "RESULT_SUCCESS":
      transition("RESULT", { ...ctx, result: "SUCCESS" });
      return true;
    case "RESULT_INVALID":
      transition("RESULT", { ...ctx, result: "INVALID" });
      return true;
    case "RESULT_NO_COIN":
      transition("RESULT", { ...ctx, result: "NO_COIN" });
      return true;
    default:
      return false;
  }
}
