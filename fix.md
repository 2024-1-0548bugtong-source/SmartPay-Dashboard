 (React frontend + serverless API).

Backend status:
- Backend is already fixed and tested locally
- /api/transactions and /api/counter both return HTTP 200 in production
- Arduino and serial bridge must NOT be changed

PROBLEMS TO FIX (frontend + transaction classification consistency):

1) Customer entry (PIR count) does not update on the dashboard
   even though GET /api/counter is being polled successfully.

2) The dashboard still displays incorrect FAILED transaction rows
   where insertedAmount appears as 0 when it should not.

FAILING EXAMPLE THAT MUST BE HANDLED CORRECTLY:

Timestamp            Product  Price (PHP)  Inserted (PHP)  Status   Reason
2026-04-29 15:21     P1       PHP 5        PHP 0           FAILED   INSUFFICIENT
2026-04-29 15:20     P2       PHP 10       PHP 0           FAILED   INSUFFICIENT
2026-04-29 15:20     P1       PHP 5        PHP 5           SUCCESS  VALID

RULES (must be reflected accurately in UI and logic):

- SUCCESS + VALID:
  insertedAmount === productPrice

- FAILED + INSUFFICIENT:
  insertedAmount < productPrice
  (including explicit insertedAmount = 0)

- FAILED + INVALID:
  insertedAmount > productPrice

IMPORTANT:
- insertedAmount = 0 is a VALID value, not “missing”
- UI must not hide, replace, or normalize 0 to something else
- Dashboard must display the exact insertedAmount returned by the API
- FAILED transactions must still show the real insertedAmount

PIR / ENTRY COUNTER RULES:

- entryCount must have independent state:
  const [entryCount, setEntryCount] = useState(0)

- entryCount must be updated ONLY from GET /api/counter
- entryCount must NOT:
  - be derived from transactions
  - reset when transactions update
  - depend on transaction success

TASK FOR COPILOT:

- Audit the dashboard frontend code
- Fix state management so transaction rows render correct insertedAmount
- Ensure FAILED rows with insertedAmount = 0 render correctly
- Fix entryCount so it updates reliably from /api/counter
- Prevent any useEffect, reducer, or formatter from overwriting these values
- Keep existing UI structure where possible
- Do NOT modify backend or hardware-related files

OUTPUT:
Provide corrected React component code (state, useEffect, fetch logic, and rendering)
that satisfies all the rules above.
