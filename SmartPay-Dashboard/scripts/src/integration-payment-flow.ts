import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { parseSerialLine } from "../../artifacts/smartpay-dashboard/src/lib/serial";

interface StatsResponse {
  todayCount: number;
  totalRevenue: number;
  successRate: number;
  hourlyData: Array<{ hour: string; count: number }>;
  currentState: string;
}

interface ApiTransaction {
  id: number;
  timestamp: string;
  event: string;
  product?: string | null;
  paymentStatus?: string | null;
  weight?: string | null;
  rawLine?: string | null;
}

async function getStats(baseUrl: string): Promise<StatsResponse> {
  const res = await fetch(`${baseUrl}/transactions/stats`);
  if (!res.ok) {
    throw new Error(`Failed to fetch stats: ${res.status}`);
  }
  return res.json() as Promise<StatsResponse>;
}

async function postTransaction(baseUrl: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${baseUrl}/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to post transaction: ${res.status} ${text}`);
  }
}

async function getTransactions(baseUrl: string): Promise<ApiTransaction[]> {
  const res = await fetch(`${baseUrl}/transactions`);
  if (!res.ok) {
    throw new Error(`Failed to fetch transactions: ${res.status}`);
  }
  return res.json() as Promise<ApiTransaction[]>;
}

async function main() {
  const dbArg = process.argv.find((arg) => arg.startsWith("--database-url="));
  if (dbArg) {
    process.env.DATABASE_URL = dbArg.replace("--database-url=", "");
  }

  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required for integration:payment-flow. Set env var or pass --database-url=<url>.",
    );
  }

  const { default: app } = await import("../../artifacts/api-server/src/app");

  const testId = `itest-${Date.now()}`;
  const server = app.listen(0);
  await once(server, "listening");

  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}/api`;

  const successScenario = [
    "SmartPay Ready",
    "Entry: 901",
    "Customer Entered",
    "Product Removed. Pay Product Two (PHP10).",
    "Pay Product Two (PHP10)",
    "Coin Detected: 7.3g -> PHP5 ACCEPTED",
    "Inserted: PHP5",
    "Remaining: PHP5",
    "Add More Coins",
    "Coin Detected: 8.8g -> PHP10 ACCEPTED",
    "Inserted: PHP15",
    "Remaining: PHP0",
    "Dispensing Product...",
    "Payment OK",
    "Customer Left",
    "SmartPay Ready",
  ];

  const failedScenario = [
    "SmartPay Ready",
    "Entry: 902",
    "Customer Entered",
    "Product Removed. Pay Product One (PHP5).",
    "Pay Product One (PHP5)",
    "Coin Detected: 6.6g -> INVALID COIN",
    "Inserted: PHP0",
    "Remaining: PHP5",
    "Add More Coins",
    "Coins: 7.3g - INSUFFICIENT",
    "Customer Left",
    "SmartPay Ready",
  ];

  const serialLines = [...successScenario, ...failedScenario];

  try {
    const before = await getStats(baseUrl);

    for (const line of serialLines) {
      const parsed = parseSerialLine(line);
      if (!parsed || !parsed.isLogEntry) {
        continue;
      }

      await postTransaction(baseUrl, {
        timestamp: new Date().toISOString(),
        event: parsed.event,
        product: parsed.product,
        paymentStatus: parsed.paymentStatus,
        weight: parsed.weight,
        rawLine: `${parsed.rawLine} [${testId}]`,
      });
    }

    const after = await getStats(baseUrl);
    const allRows = await getTransactions(baseUrl);
    const taggedRows = allRows.filter((r) => r.rawLine?.includes(`[${testId}]`));

    const paymentOkCount = taggedRows.filter((r) => r.event === "Payment OK").length;
    const paymentIncompleteCount = taggedRows.filter((r) => r.event === "Payment Incomplete").length;
    const invalidCoinCount = taggedRows.filter((r) => r.event === "Invalid Coin").length;

    if (after.totalRevenue < before.totalRevenue + 10) {
      throw new Error(
        `Revenue assertion failed. Expected at least +10, before=${before.totalRevenue}, after=${after.totalRevenue}`,
      );
    }

    if (after.todayCount <= before.todayCount) {
      throw new Error(
        `Today count assertion failed. Expected increase, before=${before.todayCount}, after=${after.todayCount}`,
      );
    }

    if (!["Ready", "Customer Present"].includes(after.currentState)) {
      throw new Error(`Current state assertion failed. Got ${after.currentState}`);
    }

    if (paymentOkCount !== 1) {
      throw new Error(`Expected exactly 1 Payment OK row in tagged data, got ${paymentOkCount}`);
    }

    if (paymentIncompleteCount < 1) {
      throw new Error("Expected at least 1 Payment Incomplete row in tagged data");
    }

    if (invalidCoinCount < 1) {
      throw new Error("Expected at least 1 Invalid Coin row in tagged data");
    }

    console.log("Integration payment-flow check passed.");
    console.log(JSON.stringify({
      before,
      after,
      taggedSummary: {
        taggedRows: taggedRows.length,
        paymentOkCount,
        paymentIncompleteCount,
        invalidCoinCount,
      },
    }, null, 2));
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
