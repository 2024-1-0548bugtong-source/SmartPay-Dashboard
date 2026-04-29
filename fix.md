using  Vercel for dashboard 
with Arduino hardware connected via CMD/Serial bridge.

PROBLEMS:
1) Transaction logs show insertedAmount = 0 for FAILED transactions
2) Customer entry (PIR count) is not showing or updating on the dashboard

==============================
TRANSACTION BUSINESS RULES
==============================

These rules MUST be followed exactly:

- SUCCESS + VALID
  → insertedAmount === productPrice

- FAILED + INSUFFICIENT
  → insertedAmount < productPrice

- FAILED + INVALID (overpayment)
  → insertedAmount > productPrice

IMPORTANT:
- insertedAmount must ALWAYS reflect the real inserted value
- This applies to BOTH SUCCESS and FAILED transactions
- insertedAmount must NEVER be reset before logging
- Reset insertedAmount ONLY AFTER the transaction is saved
- Do NOT change Arduino or PIR hardware code

Please look for:
- premature reset of insertedAmount
- logging only inside SUCCESS branches
- failure branches that overwrite insertedAmount
- defaults like `|| 0` or `?? 0` that mask real values

==============================
ARDUINO → BACKEND SYNC RULES
==============================

- Arduino sends accumulated values (coins, PIR entries)
- Backend must log received values AS-IS
- Backend must NOT assume 0 means failure
- Backend must NOT recompute values already sent by Arduino

Please inspect:
- serial parsing logic
- request body validation
- fallback/default assignments
- conditional logic that clears values on failure

==============================
PIR / CUSTOMER ENTRY ISSUE
==============================

PROBLEM:
Customer entry (PIR count) is detected by Arduino
but is NOT visible or updating on the dashboard.

EXPECTED FLOW:
PIR Sensor → Arduino → Serial/CMD Bridge → API → Database → Dashboard

Rules:
- Do NOT modify PIR sensor code
- Do NOT block PIR updates behind transactions
- PIR count should be logged independently of purchases
- Dashboard should fetch and render the latest stored PIR value

Please check:
- whether PIR data is sent in a separate API request
- whether PIR updates are ignored when no transaction occurs
- whether backend saves PIR data without overwriting it
- whether frontend fetches PIR data on load or polling
- whether state is cleared or not refreshed on the dashboard

GOAL:
Fix ONLY logic, sequencing, data handling, and state updates
so that:
- FAILED transactions log correct insertedAmount
- INVALID vs INSUFFICIENT is classified correctly
- Customer entry (PIR count) consistently appears on dashboard

Do not refactor unrelated code.
Do not change hardware behavior.
``