import { pgTable, serial, text, timestamp, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const transactionsTable = pgTable("transactions", {
  id: serial("id").primaryKey(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  event: text("event").notNull(),
  product: text("product"),
  paymentStatus: text("payment_status"),
  weight: text("weight"),
  rawLine: text("raw_line"),
});

export const insertTransactionSchema = createInsertSchema(transactionsTable).omit({ id: true });
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactionsTable.$inferSelect;
