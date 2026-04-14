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

export type ProductCode = "PHP5" | "PHP10";

export const PRODUCT_CATALOG: Record<ProductCode, { name: string; label: string; price: number }> = {
  PHP5: { name: "Product One", label: "Product One (PHP5)", price: 5 },
  PHP10: { name: "Product Two", label: "Product Two (PHP10)", price: 10 },
};

const LCD_COLS = 16;
const SENSOR_PRODUCT_TWO_MIN = 13.5;
const SENSOR_PRODUCT_TWO_MAX = 15.5;
const SENSOR_PRODUCT_ONE_MIN = 3.5;
const SENSOR_PRODUCT_ONE_MAX = 5.5;
const SENSOR_COIN_RESET_MAX = 1.0;
const SENSOR_PAYMENT_RESET_DELAY_MS = 3_000;

const sensorRuntime = {
  requiredCoins: 0,
  totalCoins: 0,
  paymentDone: false,
  paymentDoneAt: 0,
  showPaymentOkOnce: false,
};

function deriveRequiredCoins(productWeight: number): number {
  if (productWeight >= SENSOR_PRODUCT_TWO_MIN && productWeight <= SENSOR_PRODUCT_TWO_MAX) {
    return 10;
  }
  if (productWeight >= SENSOR_PRODUCT_ONE_MIN && productWeight <= SENSOR_PRODUCT_ONE_MAX) {
    return 5;
  }
  return 0;
}

function labelFromRequiredCoins(required: number): string | null {
  if (required === 5) return PRODUCT_CATALOG.PHP5.label;
  if (required === 10) return PRODUCT_CATALOG.PHP10.label;
  return null;
}

function normalizeProductCode(token: string | null | undefined): ProductCode | null {
  if (!token) return null;

  const compact = token.toUpperCase().replace(/\s+/g, "");
  const priceMatch = token.match(/(?:PHP\s*(10|5)|(10|5)\s*PHP)/i);
  const priceDigit = priceMatch?.[1] ?? priceMatch?.[2] ?? null;

  if (priceDigit === "5" || compact.includes("PRODUCTONE") || compact.includes("PRODUCT1") || compact === "P1") {
    return "PHP5";
  }

  if (priceDigit === "10" || compact.includes("PRODUCTTWO") || compact.includes("PRODUCT2") || compact === "P2") {
    return "PHP10";
  }

  return null;
}

export function formatProductLabel(token: string | null | undefined): string | null {
  const code = normalizeProductCode(token);
  if (code) return PRODUCT_CATALOG[code].label;
  return token?.trim() || null;
}

export function formatProductPrice(token: string | null | undefined): string | null {
  const code = normalizeProductCode(token);
  if (code) return `PHP${PRODUCT_CATALOG[code].price}`;

  const priceMatch = token?.match(/PHP\s*(10|5)|(10|5)\s*PHP/i);
  const digit = priceMatch?.[1] ?? priceMatch?.[2] ?? null;
  return digit ? `PHP${digit}` : null;
}

/** Pad or truncate a string to exactly 16 characters for LCD display */
export function lcdPad(s: string): string {
  return s.slice(0, LCD_COLS).padEnd(LCD_COLS, " ");
}

export function parseSerialLine(line: string): ParsedSerialLine | null {
  const raw = line.trim();
  if (!raw) return null;

  // Telemetry line format from the 24x4 hardware sketch:
  // "Product: <x> g  |  Coin: <y> g"
  const telemetryMatch = raw.match(/^product:\s*([+-]?\d+(?:\.\d+)?)\s*g\s*\|\s*coin:\s*([+-]?\d+(?:\.\d+)?)\s*g$/i);
  if (telemetryMatch) {
    const productWeight = Math.abs(Number(telemetryMatch[1]));
    const coinWeight = Math.abs(Number(telemetryMatch[2]));
    const now = Date.now();

    if (sensorRuntime.paymentDone && now - sensorRuntime.paymentDoneAt >= SENSOR_PAYMENT_RESET_DELAY_MS) {
      sensorRuntime.paymentDone = false;
      sensorRuntime.paymentDoneAt = 0;
      sensorRuntime.requiredCoins = 0;
      sensorRuntime.totalCoins = 0;
      sensorRuntime.showPaymentOkOnce = false;
    }

    const requiredCoins = deriveRequiredCoins(productWeight);
    sensorRuntime.requiredCoins = requiredCoins;

    if (!sensorRuntime.paymentDone && requiredCoins === 0 && coinWeight < SENSOR_COIN_RESET_MAX) {
      sensorRuntime.totalCoins = 0;
    }

    if (!sensorRuntime.paymentDone && requiredCoins > 0 && sensorRuntime.totalCoins >= requiredCoins) {
      sensorRuntime.paymentDone = true;
      sensorRuntime.paymentDoneAt = now;
      sensorRuntime.showPaymentOkOnce = true;
    }

    const product = labelFromRequiredCoins(requiredCoins);
    const line1 = lcdPad(`Item W:${productWeight.toFixed(2)}g`);

    if (requiredCoins === 0) {
      return {
        event: "Place Item",
        product: null,
        paymentStatus: null,
        weight: `${productWeight.toFixed(2)}g`,
        rawLine: raw,
        isLogEntry: false,
        isPirEntry: false,
        lcdState: { line1, line2: lcdPad("Place Item"), theme: "ready" },
      };
    }

    if (sensorRuntime.paymentDone) {
      if (sensorRuntime.showPaymentOkOnce) {
        sensorRuntime.showPaymentOkOnce = false;
        return {
          event: "Payment OK",
          product,
          paymentStatus: "Verified",
          weight: `${productWeight.toFixed(2)}g`,
          rawLine: raw,
          isLogEntry: true,
          isPirEntry: false,
          lcdState: { line1, line2: lcdPad("Payment OK"), theme: "ok" },
        };
      }

      return {
        event: "Sensor Resetting",
        product,
        paymentStatus: "Verified",
        weight: `${productWeight.toFixed(2)}g`,
        rawLine: raw,
        isLogEntry: false,
        isPirEntry: false,
        lcdState: { line1, line2: lcdPad("Resetting..."), theme: "info" },
      };
    }

    const statusText = `Need:${requiredCoins} Coins:${sensorRuntime.totalCoins}`;
    return {
      event: "Insert Coins",
      product,
      paymentStatus: sensorRuntime.totalCoins > 0 ? "Insufficient" : "Pending",
      weight: `${productWeight.toFixed(2)}g`,
      rawLine: raw,
      isLogEntry: false,
      isPirEntry: false,
      lcdState: { line1, line2: lcdPad(statusText), theme: "payment" },
    };
  }

  // "Detected: 5 coins | diff: 7.82"
  const detectedCoinsMatch = raw.match(/^detected:\s*(\d+)\s*coins?\s*\|\s*diff:\s*([+-]?\d+(?:\.\d+)?)$/i);
  if (detectedCoinsMatch) {
    const coinValue = Number(detectedCoinsMatch[1]);
    const diff = Number(detectedCoinsMatch[2]);

    if (!sensorRuntime.paymentDone && sensorRuntime.requiredCoins > 0) {
      sensorRuntime.totalCoins += coinValue;
    }

    const remaining = Math.max(sensorRuntime.requiredCoins - sensorRuntime.totalCoins, 0);

    return {
      event: "Coin Detected",
      product: coinValue === 5 ? "PHP5" : coinValue === 10 ? "PHP10" : null,
      paymentStatus: remaining > 0 ? "Pending" : "Verified",
      weight: `${diff.toFixed(2)}g`,
      rawLine: raw,
      isLogEntry: true,
      isPirEntry: false,
      lcdState: {
        line1: lcdPad(`Coins:${sensorRuntime.totalCoins}`),
        line2: lcdPad(remaining > 0 ? `Insert Coins...` : "Checking..."),
        theme: remaining > 0 ? "payment" : "info",
      },
    };
  }

  // "Ignored noisy/invalid diff: 1.23"
  const noisyDiffMatch = raw.match(/^ignored\s+noisy\/invalid\s+diff:\s*([+-]?\d+(?:\.\d+)?)$/i);
  if (noisyDiffMatch) {
    const diff = Number(noisyDiffMatch[1]);
    return {
      event: "Invalid Coin",
      product: null,
      paymentStatus: "Insufficient",
      weight: `${diff.toFixed(2)}g`,
      rawLine: raw,
      isLogEntry: true,
      isPirEntry: false,
      lcdState: { line1: lcdPad("Invalid Coin"), line2: lcdPad("Insert Coins..."), theme: "error" },
    };
  }

  // ── LCD-only state lines ──────────────────────────────────────────────

  // "SmartPay Ready"
  if (/^smartpay ready/i.test(raw)) {
    return {
      event: "SmartPay Ready",
      product: null,
      paymentStatus: null,
      weight: null,
      rawLine: raw,
      isLogEntry: true,
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
      isLogEntry: true,
      isPirEntry: false,
      lcdState: { line1: lcdPad("Customer Entered"), line2: lcdPad("  Please wait..."), theme: "entry" },
    };
  }

  // "Pay PHP5" or "Pay Product One (PHP5)" (LCD confirmation prompt)
  const payPromptMatch = raw.match(/^pay\s+(.+)$/i);
  if (payPromptMatch) {
    const product = formatProductLabel(payPromptMatch[1]);
    const price = formatProductPrice(payPromptMatch[1]);
    return {
      event: product ? `Pay ${product}` : "Pay",
      product,
      paymentStatus: "Pending",
      weight: null,
      rawLine: raw,
      isLogEntry: true,
      isPirEntry: false,
      lcdState: { line1: lcdPad(`Insert Coins:`), line2: lcdPad(`  Please pay ${price ?? "coins"}`), theme: "payment" },
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
      isLogEntry: true,
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
      isLogEntry: true,
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

  // "Product Removed. Pay PHP5." or "Product Removed. Pay Product One (PHP5)."
  const productMatch = raw.match(/product removed[.\s]*(?:pay\s*(.+))?/i);
  if (productMatch) {
    const product = formatProductLabel(productMatch[1] ?? null);
    const price = formatProductPrice(productMatch[1] ?? null);
    return {
      event: "Product Removed",
      product,
      paymentStatus: product ? "Pending" : null,
      weight: null,
      rawLine: raw,
      isLogEntry: true,
      isPirEntry: false,
      lcdState: product
        ? { line1: lcdPad("Product Removed"), line2: lcdPad(`  Pay ${price ?? "coins"}`), theme: "payment" }
        : { line1: lcdPad("Product Removed"), line2: lcdPad("  Insert coins"), theme: "payment" },
    };
  }

  // "Coin Detected: 7.3g -> PHP5 ACCEPTED"
  const coinAcceptedMatch = raw.match(/coin\s+detected:\s*([\d.]+)g\s*->\s*((?:PHP|₱)\s*(?:5|10))\s*accepted/i);
  if (coinAcceptedMatch) {
    const product = formatProductLabel(coinAcceptedMatch[2]);
    return {
      event: "Coin Detected",
      product,
      paymentStatus: null,
      weight: `${coinAcceptedMatch[1]}g`,
      rawLine: raw,
      isLogEntry: true,
      isPirEntry: false,
      lcdState: { line1: lcdPad("Coin Accepted"), line2: lcdPad(` ${coinAcceptedMatch[1]}g`), theme: "info" },
    };
  }

  // "Coin Detected: 7.9g -> INVALID COIN"
  const coinInvalidMatch = raw.match(/coin\s+detected:\s*([\d.]+)g\s*->\s*invalid\s+coin/i);
  if (coinInvalidMatch) {
    return {
      event: "Invalid Coin",
      product: null,
      paymentStatus: null,
      weight: `${coinInvalidMatch[1]}g`,
      rawLine: raw,
      isLogEntry: true,
      isPirEntry: false,
      lcdState: { line1: lcdPad("Invalid Coin"), line2: lcdPad(` ${coinInvalidMatch[1]}g`), theme: "error" },
    };
  }

  // "Inserted: PHP5"
  const insertedMatch = raw.match(/^inserted:\s*(?:php|₱)\s*(\d+)$/i);
  if (insertedMatch) {
    return {
      event: "Inserted Balance",
      product: null,
      paymentStatus: null,
      weight: null,
      rawLine: raw,
      isLogEntry: true,
      isPirEntry: false,
      lcdState: { line1: lcdPad("Balance Updated"), line2: lcdPad(` PHP${insertedMatch[1]} inserted`), theme: "info" },
    };
  }

  // "Remaining: PHP5"
  const remainingMatch = raw.match(/^remaining:\s*(?:php|₱)\s*(\d+)$/i);
  if (remainingMatch) {
    const remaining = Number(remainingMatch[1]);
    return {
      event: "Remaining Balance",
      product: null,
      paymentStatus: null,
      weight: null,
      rawLine: raw,
      isLogEntry: true,
      isPirEntry: false,
      lcdState: {
        line1: lcdPad("Remaining"),
        line2: lcdPad(remaining > 0 ? ` PHP${remaining} to pay` : " Paid in full"),
        theme: remaining > 0 ? "payment" : "ok",
      },
    };
  }

  // "Dispensing Product..."
  if (/^dispensing product/i.test(raw)) {
    return {
      event: "Dispensing Product",
      product: null,
      paymentStatus: null,
      weight: null,
      rawLine: raw,
      isLogEntry: true,
      isPirEntry: false,
      lcdState: { line1: lcdPad("Dispensing..."), line2: lcdPad(" Please wait"), theme: "ok" },
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
