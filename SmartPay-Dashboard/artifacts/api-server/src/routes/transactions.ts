import { Router, type IRouter } from "express";
import { db, transactionsTable } from "@workspace/db";
import { desc, gte } from "drizzle-orm";
import { CreateTransactionBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/transactions", async (_req, res) => {
  const rows = await db
    .select()
    .from(transactionsTable)
    .orderBy(desc(transactionsTable.timestamp));
  res.json(rows);
});

router.post("/transactions", async (req, res) => {
  const body = CreateTransactionBody.parse(req.body);
  const [created] = await db
    .insert(transactionsTable)
    .values({
      timestamp: body.timestamp ? new Date(body.timestamp) : new Date(),
      event: body.event,
      product: body.product ?? null,
      paymentStatus: body.paymentStatus ?? null,
      weight: body.weight ?? null,
      rawLine: body.rawLine ?? null,
    })
    .returning();
  res.status(201).json(created);
});

router.get("/transactions/export", async (_req, res) => {
  const rows = await db
    .select()
    .from(transactionsTable)
    .orderBy(desc(transactionsTable.timestamp));

  const header = "Timestamp,Event,Product,Payment Status,Weight,Raw Line\n";
  const csvRows = rows
    .map((r) => {
      const cols = [
        r.timestamp.toISOString(),
        r.event,
        r.product ?? "",
        r.paymentStatus ?? "",
        r.weight ?? "",
        r.rawLine ?? "",
      ].map((c) => `"${String(c).replace(/"/g, '""')}"`);
      return cols.join(",");
    })
    .join("\n");

  const csv = header + csvRows;
  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="smartpay_export_${new Date().toISOString().slice(0, 10)}.csv"`,
  );
  res.send(csv);
});

router.get("/transactions/stats", async (_req, res) => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayRows = await db
    .select()
    .from(transactionsTable)
    .where(gte(transactionsTable.timestamp, todayStart));

  const todayCount = todayRows.length;

  let totalRevenue = 0;
  let verifiedCount = 0;
  let paymentEventCount = 0;

  for (const row of todayRows) {
    if (row.paymentStatus === "Verified") {
      const match = row.product?.match(/PHP(\d+)/i);
      if (match) totalRevenue += parseInt(match[1], 10);
      verifiedCount++;
    }
    if (row.paymentStatus != null) {
      paymentEventCount++;
    }
  }

  const successRate =
    paymentEventCount > 0
      ? Math.round((verifiedCount / paymentEventCount) * 100)
      : 100;

  const lastEntry = todayRows
    .slice()
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];

  let currentState = "Ready";
  if (lastEntry) {
    const ev = lastEntry.event.toLowerCase();
    if (ev.includes("entry")) currentState = "Customer Present";
    else if (ev.includes("product removed")) currentState = "Customer Present";
    else if (ev.includes("payment ok") || ev.includes("payment incomplete"))
      currentState = "Customer Present";
    else if (ev.includes("customer left")) currentState = "Ready";
  }

  const hourlyCounts: Record<string, number> = {};
  for (let h = 0; h < 24; h++) {
    const label = `${String(h).padStart(2, "0")}:00`;
    hourlyCounts[label] = 0;
  }
  for (const row of todayRows) {
    const h = row.timestamp.getHours();
    const label = `${String(h).padStart(2, "0")}:00`;
    hourlyCounts[label] = (hourlyCounts[label] ?? 0) + 1;
  }

  const currentHour = new Date().getHours();
  const hourlyData = Object.entries(hourlyCounts)
    .filter(([label]) => {
      const h = parseInt(label.split(":")[0], 10);
      return h <= currentHour && h >= Math.max(0, currentHour - 11);
    })
    .map(([hour, count]) => ({ hour, count }));

  res.json({
    todayCount,
    totalRevenue,
    successRate,
    hourlyData,
    currentState,
  });
});

export default router;
