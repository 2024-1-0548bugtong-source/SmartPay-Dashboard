I am debugging a Node.js CMD/Serial bridge that forwards Arduino events
(PIR entries and vending transactions) to a Vercel API.

Backend and dashboard are already working and must NOT be modified.
Arduino/hardware logic is correct and must NOT be modified.

==============================
PROBLEMS TO FIX (BRIDGE ONLY)
==============================

1) Customer entry (PIR) events are detected in logs but never reach the backend,
   so /api/counter never increments and the dashboard does not update.

2) FAILED transactions show Inserted PHP = 0 in the dashboard,
   even though the hardware correctly detected inserted coins.

==============================
ROOT CAUSES IDENTIFIED
==============================

A) PIR DEDUPLICATION BUG
- All PIR events are dropped because deduplication runs BEFORE a send happens.
- lastPirSentAt is updated too early, causing the FIRST valid Entry event to be skipped.
- Deduplication must suppress only rapid repeats, not the initial trigger.

B) INSERTED AMOUNT LOSS
- FAILED transactions reconstruct payloads after ongoingTransaction is cleared.
- This forces inserted to default to 0.
- A completed transaction must not depend on mutable state to reconstruct inserted.

==============================
REQUIRED FIXES
==============================

1) PIR EVENT HANDLING
-------------------
- Normalize ALL PIR variants ("Entry", "entry", "Customer Entered") into ONE canonical event: "Entry"
- Deduplicate PIR events ONLY after a successful POST to the backend
- Do NOT update lastPirSentAt when merely seeing or parsing an event
- Update lastPirSentAt ONLY after sending an Entry event successfully

Correct pattern:
- Detect PIR
- Send Entry immediately
- THEN start dedupe window

2) TRANSACTION INSERTED LOGIC
-----------------------------
- FAILED transactions must preserve the REAL inserted amount
- Never default inserted to 0 just because ongoingTransaction is null
- Do NOT reconstruct FAILED transactions from summary lines like:
  "transaction:failed:P1:insufficient"

Correct approach (choose one):
- Ignore FAILED transaction summary lines entirely and rely on
  consumeEventTransaction() which already has correct inserted value
OR
- Store lastKnownInserted separately and use it for FAILED transactions

Rule:
- Inserted PHP = 0 is valid only if ZERO coins were actually inserted,
  not because state was cleared.

==============================
WHAT NOT TO CHANGE
==============================

- Do NOT modify Arduino code
- Do NOT modify backend API or dashboard React code
- Do NOT change API schemas
- Do NOT remove deduplication entirely

==============================
GOAL
==============================

After fixes:
- First PIR trigger ALWAYS sends exactly one { event: "Entry" }
- /api/counter increments correctly
- Dashboard updates live
- FAILED transactions display correct Inserted PHP
- INVALID vs INSUFFICIENT logic remains accurate

Please apply the minimal, correct changes directly in this bridge file
to satisfy all rules above.
``