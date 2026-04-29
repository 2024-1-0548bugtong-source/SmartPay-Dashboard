What the dashboard is telling us (facts, not guesses)
From your dashboard:
SUCCESS → Inserted correct (PHP 10, PHP 5)
FAILED  → Inserted always PHP 0  ❌

From PIR section:
PIR Entries Today: 0
Live Counter API: 0

From CMD:
Entry: 3
{"event":"Entry","rawLine":"Entry: 3"}
{"event":"Customer Entered","rawLine":"Customer Entered"}

✅ Arduino is sending Entry events
✅ Arduino is tracking insertedAmount correctly
❌ Dashboard never reflects PIR
❌ Dashboard receives FAILED transactions with inserted = 0
So two failures remain, both 100% in the bridge, not Arduino, not dashboard.

🔎 Root Cause #1 — PIR entries never reach the backend What is happening
Your Arduino sends TWO PIR JSON events back‑to‑back:
Root Cause #2 — FAILED transactions show Inserted PHP = 0
This one is completely independent of PIR.
debug from head to toe to avoid errors and dashboard now reads and outputs correctly. write a clean code
