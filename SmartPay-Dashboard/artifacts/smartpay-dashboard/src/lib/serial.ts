export type LcdTheme = "ready" | "entry" | "payment" | "ok" | "error" | "info";

export interface LcdState {
  line1: string;
  line2: string;
  theme: LcdTheme;
}

export interface ParsedSerialLine {
  event: string;
  product: string | null;
  paymentStatus: string | null;
  weight: string | null;
  rawLine: string;
  isLogEntry: boolean;       // false = LCD-only state line, skip transaction table
  isPirEntry: boolean;       // true = increment PIR entry counter
  lcdState: LcdState | null; // non-null = update LCD display
}

const LCD_COLS = 16;

/** Pad or truncate a string to exactly 16 characters for LCD display */
export function lcdPad(s: string): string {
  return s.slice(0, LCD_COLS).padEnd(LCD_COLS, " ");
}

export function parseSerialLine(line: string): ParsedSerialLine | null {
  const raw = line.trim();
  if (!raw) return null;

  // ── LCD-only state lines ──────────────────────────────────────────────

  // "SmartPay Ready"
  if (/^smartpay ready/i.test(raw)) {
    return {
      event: "SmartPay Ready",
      product: null,
      paymentStatus: null,
      weight: null,
      rawLine: raw,
      isLogEntry: false,
      isPirEntry: false,
      lcdState: { line1: lcdPad("** SmartPay **"), line2: lcdPad("    Ready"), theme: "ready" },
    };
  }

  // "Customer Entered"
  if (/^customer entered/i.test(raw)) {
    return {
      event: "Customer Entered",
      product: null,
      paymentStatus: null,
      weight: null,
      rawLine: raw,
      isLogEntry: false,
      isPirEntry: false,
      lcdState: { line1: lcdPad("Customer Entered"), line2: lcdPad("  Please wait..."), theme: "entry" },
    };
  }

  // "Pay PHP5" (LCD confirmation prompt)
  const payPromptMatch = raw.match(/^pay\s+(PHP\d+)$/i);
  if (payPromptMatch) {
    const amt = payPromptMatch[1].toUpperCase();
    return {
      event: `Pay ${amt}`,
      product: amt,
      paymentStatus: "Pending",
      weight: null,
      rawLine: raw,
      isLogEntry: false,
      isPirEntry: false,
      lcdState: { line1: lcdPad(`Insert Coins:`), line2: lcdPad(`  Please pay ${amt}`), theme: "payment" },
    };
  }

  // "Payment OK" (LCD confirmation)
  if (/^payment ok/i.test(raw)) {
    return {
      event: "Payment OK",
      product: null,
      paymentStatus: "Verified",
      weight: null,
      rawLine: raw,
      isLogEntry: false,
      isPirEntry: false,
      lcdState: { line1: lcdPad("** Payment OK! **"), line2: lcdPad(" Thank you! :)"), theme: "ok" },
    };
  }

  // "Add More Coins"
  if (/^add more coins/i.test(raw)) {
    return {
      event: "Add More Coins",
      product: null,
      paymentStatus: "Insufficient",
      weight: null,
      rawLine: raw,
      isLogEntry: false,
      isPirEntry: false,
      lcdState: { line1: lcdPad("Insufficient!"), line2: lcdPad("Add More Coins"), theme: "error" },
    };
  }

  // ── Transaction log lines ─────────────────────────────────────────────

  // "Entry: 124" — PIR sensor trigger
  if (/^entry/i.test(raw)) {
    const numMatch = raw.match(/entry:\s*(\d+)/i);
    const label = numMatch ? `PIR #${numMatch[1]}` : "PIR Trigger";
    return {
      event: "Entry",
      product: null,
      paymentStatus: null,
      weight: null,
      rawLine: raw,
      isLogEntry: true,
      isPirEntry: true,
      lcdState: { line1: lcdPad("Customer Entered"), line2: lcdPad(`  ${label}`), theme: "entry" },
    };
  }

  // "Product Removed. Pay PHP5."
  const productMatch = raw.match(/product removed[.\s]*(?:pay\s*(PHP\d+))?/i);
  if (productMatch) {
    const product = productMatch[1]?.toUpperCase() ?? null;
    return {
      event: "Product Removed",
      product,
      paymentStatus: product ? "Pending" : null,
      weight: null,
      rawLine: raw,
      isLogEntry: true,
      isPirEntry: false,
      lcdState: product
        ? { line1: lcdPad("Product Removed"), line2: lcdPad(`  Pay ${product}`), theme: "payment" }
        : { line1: lcdPad("Product Removed"), line2: lcdPad("  Insert coins"), theme: "payment" },
    };
  }

  // "Coins: 5.2g - OK"
  const coinsOkMatch = raw.match(/coins:\s*([\d.]+)g\s*-\s*OK/i);
  if (coinsOkMatch) {
    return {
      event: "Payment OK",
      product: null,
      paymentStatus: "Verified",
      weight: `${coinsOkMatch[1]}g`,
      rawLine: raw,
      isLogEntry: true,
      isPirEntry: false,
      lcdState: { line1: lcdPad("** Payment OK! **"), line2: lcdPad(` ${coinsOkMatch[1]}g - Verified`), theme: "ok" },
    };
  }

  // "Coins: 3.1g - INSUFFICIENT"
  const coinsFailMatch = raw.match(/coins:\s*([\d.]+)g\s*-\s*insufficient/i);
  if (coinsFailMatch) {
    return {
      event: "Payment Incomplete",
      product: null,
      paymentStatus: "Insufficient",
      weight: `${coinsFailMatch[1]}g`,
      rawLine: raw,
      isLogEntry: true,
      isPirEntry: false,
      lcdState: { line1: lcdPad("Insufficient!"), line2: lcdPad(` ${coinsFailMatch[1]}g - Add more`), theme: "error" },
    };
  }

  // "Customer Left"
  if (/customer left/i.test(raw)) {
    return {
      event: "Customer Left",
      product: null,
      paymentStatus: null,
      weight: null,
      rawLine: raw,
      isLogEntry: true,
      isPirEntry: false,
      lcdState: { line1: lcdPad("** SmartPay **"), line2: lcdPad("    Ready"), theme: "ready" },
    };
  }

  // Generic fallback — log it but don't change LCD
  return {
    event: raw.slice(0, 80),
    product: null,
    paymentStatus: null,
    weight: null,
    rawLine: raw,
    isLogEntry: true,
    isPirEntry: false,
    lcdState: null,
  };
}
