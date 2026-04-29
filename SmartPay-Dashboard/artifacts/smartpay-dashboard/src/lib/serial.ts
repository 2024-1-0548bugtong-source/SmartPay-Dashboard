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

const verboseTelemetryRuntime = {
  lastCoinValue: 0,
  lastProductType: 0,
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

function labelFromProductType(productType: number): string | null {
  if (productType === 1) return PRODUCT_CATALOG.PHP5.label;
  if (productType === 2) return PRODUCT_CATALOG.PHP10.label;
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

function normalizeEventName(event: string): string {
  const ev = event.trim().toLowerCase();
  if (ev === "customer_entered" || ev === "customer entered") return "Customer Entered";
  if (ev === "customer_left" || ev === "customer left") return "Customer Left";
  if (ev === "smartpay ready" || ev === "honestpay ready" || ev === "ready") return "HonestPay Ready";
  if (ev === "payment ok" || ev === "payment_success" || ev === "payment success") return "Payment OK";
  if (ev === "payment invalid" || ev === "payment_invalid") return "Invalid Coin";
  if (ev === "payment incomplete" || ev === "payment_fail" || ev === "payment failed") return "Payment Incomplete";
  if (ev === "add more coins") return "Add More Coins";
  if (ev.startsWith("payment status:")) return "Invalid Coin";
  if (ev === "dispensing product" || ev === "dispense") return "Dispensing Product";
  if (ev === "product removed") return "Product Removed";
  if (ev === "insert coins" || ev === "insert coin") return "Insert Coins";
  if (ev === "coin detected") return "Coin Detected";
  if (ev === "entry") return "Entry";
  return event.trim();
}

function parseJsonSerialLine(raw: string): ParsedSerialLine | null {
  if (!raw.startsWith("{")) return null;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const eventRaw = typeof parsed.event === "string" ? parsed.event.trim() : null;
    const statusRaw = typeof parsed.status === "string" ? parsed.status.trim() : null;

    const event = eventRaw ? normalizeEventName(eventRaw) : null;
    const status = statusRaw ? normalizeEventName(statusRaw) : null;

    const product = (() => {
      if (typeof parsed.product === "string") return formatProductLabel(parsed.product);
      if (typeof parsed.product === "number") {
        if (parsed.product === 1) return PRODUCT_CATALOG.PHP5.label;
        if (parsed.product === 2) return PRODUCT_CATALOG.PHP10.label;
      }
      return null;
    })();

    const coinValue = typeof parsed.coin === "number" ? parsed.coin : null;
    const coinProduct = coinValue === 5 ? PRODUCT_CATALOG.PHP5.label : coinValue === 10 ? PRODUCT_CATALOG.PHP10.label : null;
    const paymentStatus = typeof parsed.paymentStatus === "string"
      ? parsed.paymentStatus
      : typeof parsed.payment === "string"
        ? parsed.payment.toLowerCase() === "success"
          ? "Verified"
          : parsed.payment.toLowerCase() === "fail"
            ? "Insufficient"
            : null
        : null;

    const numericWeight = typeof parsed.weight === "number"
      ? parsed.weight
      : typeof parsed.product_w === "number"
        ? parsed.product_w
        : typeof parsed.coin_w === "number"
          ? parsed.coin_w
          : null;

    const inserted = typeof parsed.inserted === "number" ? parsed.inserted : null;
    const remaining = typeof parsed.remaining === "number" ? parsed.remaining : null;

    const telemetryPresent =
      typeof parsed.product_w === "number" ||
      typeof parsed.coin_w === "number" ||
      typeof parsed.inserted === "number" ||
      typeof parsed.remaining === "number";

    const resolvedEvent =
      event ??
      status ??
      (typeof parsed.payment === "string"
        ? parsed.payment.toLowerCase() === "success"
          ? "Payment OK"
          : parsed.payment.toLowerCase() === "fail"
            ? "Payment Incomplete"
            : null
        : null) ??
      (coinValue !== null && coinValue > 0 ? "Coin Detected" : null) ??
      (typeof parsed.inserted === "number" ? "Inserted Balance" : null) ??
      (typeof parsed.remaining === "number" ? "Remaining Balance" : null) ??
      (telemetryPresent ? "Telemetry" : null);
    if (!resolvedEvent || resolvedEvent === "Remaining Balance") return null;

    const normalized = resolvedEvent.toLowerCase();
    const lcdState: LcdState | null = (() => {
      if (normalized === "honestpay ready" || normalized === "smartpay ready") return { line1: lcdPad("** HonestPay **"), line2: lcdPad("    Ready"), theme: "ready" };
      if (normalized === "customer entered") return { line1: lcdPad("Customer Entered"), line2: lcdPad("  Please wait..."), theme: "entry" };
      if (normalized === "product removed") return { line1: lcdPad("Product Removed"), line2: lcdPad(`  Pay ${product ?? "coins"}`), theme: "payment" };
      if (normalized.startsWith("pay ")) return { line1: lcdPad("Insert Coins:"), line2: lcdPad(`  Please pay ${product?.replace(/^.*\((PHP\d+)\).*$/i, "$1") ?? "coins"}`), theme: "payment" };
      if (normalized === "payment ok") return { line1: lcdPad("** Payment OK! **"), line2: lcdPad(" Thank you! :)"), theme: "ok" };
      if (normalized === "invalid coin") return { line1: lcdPad("Invalid Coin"), line2: lcdPad(paymentStatus === "No coin detected" ? " No coin detect" : " Insufficient"), theme: "error" };
      if (normalized === "payment incomplete") return { line1: lcdPad("Invalid Coin"), line2: lcdPad(" Insufficient"), theme: "error" };
      if (normalized === "add more coins") return { line1: lcdPad("Invalid Coin"), line2: lcdPad(" Insufficient"), theme: "error" };
      if (normalized === "entry") return { line1: lcdPad("Customer Entered"), line2: lcdPad("  Please wait..."), theme: "entry" };
      if (normalized === "dispensing product") return { line1: lcdPad("Dispensing..."), line2: lcdPad(" Please wait"), theme: "ok" };
      if (normalized === "coin detected") return { line1: lcdPad("Coin Detected"), line2: lcdPad(`${product ? ` ${product.replace(/^.*\((PHP\d+)\).*$/i, "$1")}` : ""}${numericWeight !== null ? ` ${numericWeight.toFixed(2)}g` : ""}`.trim() || " Validating"), theme: "info" };
      if (normalized === "telemetry") return { line1: lcdPad(`P:${parsed.product_w ?? 0}`), line2: lcdPad(`C:${parsed.coin_w ?? 0}`), theme: "info" };
      return null;
    })();

    const isPirEntry = normalized === "entry" || normalized === "customer entered";
    const isLogEntry = normalized !== "telemetry";

    return {
      event: resolvedEvent,
      product: product ?? (resolvedEvent === "Coin Detected" ? coinProduct : null),
      paymentStatus,
      weight: numericWeight !== null ? `${numericWeight.toFixed(2)}g` : null,
      rawLine: raw,
      isLogEntry,
      isPirEntry,
      lcdState,
    };
  } catch {
    return null;
  }
}

export function parseSerialLine(line: string): ParsedSerialLine | null {
  const raw = line.trim();
  if (!raw) return null;

  if (raw.startsWith("{")) {
    // If a payload is JSON-ish, don't fall back to generic text parsing.
    // Invalid/incomplete JSON should be ignored instead of polluting the table.
    return parseJsonSerialLine(raw);
  }

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

  const verboseTelemetryMatch = raw.match(
    /^product\s+weight:\s*([+-]?\d+(?:\.\d+)?)\s*g\s*\|\s*coin\s+weight:\s*([+-]?\d+(?:\.\d+)?)\s*g\s*\|\s*product\s+type:\s*(\d+)\s*\|\s*coin\s+value:\s*(\d+)\s*\|\s*payment:\s*(ok|not\s+ok)$/i
  );
  if (verboseTelemetryMatch) {
    const coinWeight = Math.abs(Number(verboseTelemetryMatch[2]));
    const productType = Number(verboseTelemetryMatch[3]);
    const coinValue = Number(verboseTelemetryMatch[4]);
    const product = labelFromProductType(productType);

    if (!Number.isFinite(coinValue) || coinValue <= 0 || !product) {
      verboseTelemetryRuntime.lastCoinValue = 0;
      verboseTelemetryRuntime.lastProductType = productType;
      return null;
    }

    const isNewCoinEdge =
      verboseTelemetryRuntime.lastCoinValue !== coinValue ||
      verboseTelemetryRuntime.lastProductType !== productType;

    verboseTelemetryRuntime.lastCoinValue = coinValue;
    verboseTelemetryRuntime.lastProductType = productType;

    if (!isNewCoinEdge) {
      return null;
    }

    return {
      event: "Inserted Balance",
      product,
      paymentStatus: "Pending",
      weight: `${coinWeight.toFixed(2)}g`,
      rawLine: raw,
      isLogEntry: true,
      isPirEntry: false,
      lcdState: {
        line1: lcdPad("Inserted Balance"),
        line2: lcdPad(` PHP${coinValue}`),
        theme: "payment",
      },
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
      lcdState: { line1: lcdPad("Invalid Coin"), line2: lcdPad(" Insufficient"), theme: "error" },
    };
  }

  // ── LCD-only state lines ──────────────────────────────────────────────

  // "HonestPay Ready" / legacy "SmartPay Ready"
  if (/^(smartpay|honestpay) ready/i.test(raw)) {
    return {
      event: "HonestPay Ready",
      product: null,
      paymentStatus: null,
      weight: null,
      rawLine: raw,
      isLogEntry: true,
      isPirEntry: false,
      lcdState: { line1: lcdPad("** HonestPay **"), line2: lcdPad("    Ready"), theme: "ready" },
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
      isPirEntry: true,
      lcdState: { line1: lcdPad("Customer Entered"), line2: lcdPad("  Please wait..."), theme: "entry" },
    };
  }

  // Contract line: "no product - P1: 200g =P5"
  const contractProductRemovedMatch = raw.match(/^no\s+product\s*-\s*(p[12])\s*:\s*([+-]?\d+(?:\.\d+)?)g\s*=\s*p(?:5|10)$/i);
  if (contractProductRemovedMatch) {
    const product = formatProductLabel(contractProductRemovedMatch[1]);
    const price = formatProductPrice(contractProductRemovedMatch[1]);
    const weight = `${Number(contractProductRemovedMatch[2]).toFixed(2)}g`;
    return {
      event: "Product Removed",
      product,
      paymentStatus: product ? "Pending" : null,
      weight,
      rawLine: raw,
      isLogEntry: true,
      isPirEntry: false,
      lcdState: product
        ? { line1: lcdPad("Product Removed"), line2: lcdPad(`  Pay ${price ?? "coins"}`), theme: "payment" }
        : { line1: lcdPad("Product Removed"), line2: lcdPad("  Insert coins"), theme: "payment" },
    };
  }

  // Contract line: "insert coin - COIN : 5PESOS"
  const contractInsertCoinMatch = raw.match(/^insert\s+coin\s*-\s*coin\s*:\s*(5|10)\s*pesos$/i);
  if (contractInsertCoinMatch) {
    const product = formatProductLabel(`PHP${contractInsertCoinMatch[1]}`);
    return {
      event: "Inserted Balance",
      product,
      paymentStatus: "Pending",
      weight: null,
      rawLine: raw,
      isLogEntry: true,
      isPirEntry: false,
      lcdState: { line1: lcdPad("Inserted Balance"), line2: lcdPad(` PHP${contractInsertCoinMatch[1]}`), theme: "payment" },
    };
  }

  // Contract line: "insert coin - (no coin)"
  if (/^insert\s+coin\s*-\s*\(no\s+coin\)$/i.test(raw)) {
    return {
      event: "Invalid Coin",
      product: null,
      paymentStatus: "No coin detected",
      weight: null,
      rawLine: raw,
      isLogEntry: true,
      isPirEntry: false,
      lcdState: { line1: lcdPad("Invalid Coin"), line2: lcdPad(" No coin detect"), theme: "error" },
    };
  }

  const paymentStatusMatch = raw.match(/^payment\s+status:\s*(insufficient|no\s+coin\s+detected)$/i);
  if (paymentStatusMatch) {
    const paymentStatus = paymentStatusMatch[1].toLowerCase() === "insufficient"
      ? "Insufficient"
      : "No coin detected";
    return {
      event: "Invalid Coin",
      product: null,
      paymentStatus,
      weight: null,
      rawLine: raw,
      isLogEntry: false,
      isPirEntry: false,
      lcdState: {
        line1: lcdPad("Invalid Coin"),
        line2: lcdPad(paymentStatus === "Insufficient" ? " Insufficient" : " No coin detect"),
        theme: "error",
      },
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

  // Contract line: "waiting payment - PAYMENT SUCCESS"
  if (/^waiting\s+payment\s*-\s*payment\s+success$/i.test(raw)) {
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

  // Contract line: "PAYMENT INVALID" or "waiting payment - PAYMENT INVALID"
  if (/^(?:waiting\s+payment\s*-\s*)?payment\s+invalid$/i.test(raw)) {
    return {
      event: "Invalid Coin",
      product: null,
      paymentStatus: "Insufficient",
      weight: null,
      rawLine: raw,
      isLogEntry: true,
      isPirEntry: false,
      lcdState: { line1: lcdPad("Invalid Coin"), line2: lcdPad(" Insufficient"), theme: "error" },
    };
  }

  // "Add More Coins"
  if (/^add more coins/i.test(raw)) {
    return {
      event: "Invalid Coin",
      product: null,
      paymentStatus: "Insufficient",
      weight: null,
      rawLine: raw,
      isLogEntry: true,
      isPirEntry: false,
      lcdState: { line1: lcdPad("Invalid Coin"), line2: lcdPad(" Insufficient"), theme: "error" },
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

  // "Product Removed. Pay PHP5." or "Product Removed Product Two (PHP10)."
  // Accept both "Pay ..." and direct product suffixes from different sketches.
  const productMatch = raw.match(/product removed[.\s]*(?:pay\s*)?(.*)$/i);
  if (productMatch) {
    const captured = (productMatch[1] ?? "").trim();
    const product = captured ? formatProductLabel(captured) : null;
    const price = captured ? formatProductPrice(captured) : null;
    return {
      event: "Product Removed",
      product,
      // Product removed implies awaiting payment for that product.
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
  const coinAcceptedMatch = raw.match(/coin\s+detected:\s*([\d.]+)g\s*->\s*((?:PHP|₱)\s*(?:5|10))(?:\s*accepted)?/i);
  if (coinAcceptedMatch) {
    const product = formatProductLabel(coinAcceptedMatch[2]);
    const price = formatProductPrice(coinAcceptedMatch[2]);
    return {
      event: "Coin Detected",
      product,
      paymentStatus: null,
      weight: `${coinAcceptedMatch[1]}g`,
      rawLine: raw,
      isLogEntry: true,
      isPirEntry: false,
      lcdState: { line1: lcdPad("Coin Detected"), line2: lcdPad(`${price ?? "coin"} ${coinAcceptedMatch[1]}g`), theme: "info" },
    };
  }

  // "Coin Detected: 7.9g -> INVALID COIN"
  const coinInvalidMatch = raw.match(/coin\s+detected:\s*([\d.]+)g\s*->\s*invalid\s+coin/i);
  if (coinInvalidMatch) {
    return {
      event: "Invalid Coin",
      product: null,
      paymentStatus: "Insufficient",
      weight: `${coinInvalidMatch[1]}g`,
      rawLine: raw,
      isLogEntry: true,
      isPirEntry: false,
      lcdState: { line1: lcdPad("Invalid Coin"), line2: lcdPad(" Insufficient"), theme: "error" },
    };
  }

  // "Inserted: PHP5"
  const insertedMatch = raw.match(/^inserted:\s*(?:php|₱)\s*(\d+)$/i);
  if (insertedMatch) {
    return {
      event: "Inserted Balance",
      product: formatProductLabel(`PHP${insertedMatch[1]}`),
      paymentStatus: "Pending",
      weight: null,
      rawLine: raw,
      isLogEntry: true,
      isPirEntry: false,
      lcdState: { line1: lcdPad("Inserted Balance"), line2: lcdPad(` PHP${insertedMatch[1]}`), theme: "payment" },
    };
  }

  // "Remaining: PHP5"
  const remainingMatch = raw.match(/^remaining:\s*(?:php|₱)\s*(\d+)$/i);
  if (remainingMatch) {
    return null;
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
      event: "Invalid Coin",
      product: null,
      paymentStatus: "Insufficient",
      weight: `${coinsFailMatch[1]}g`,
      rawLine: raw,
      isLogEntry: true,
      isPirEntry: false,
      lcdState: { line1: lcdPad("Invalid Coin"), line2: lcdPad(" Insufficient"), theme: "error" },
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
      lcdState: { line1: lcdPad("** HonestPay **"), line2: lcdPad("    Ready"), theme: "ready" },
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
