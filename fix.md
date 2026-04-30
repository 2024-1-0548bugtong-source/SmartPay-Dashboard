Copilot, you are misclassifying FAILED transactions.

IMPORTANT CORRECTION:
Inserted PHP = 0 in these FAILED transactions is NOT an error.
It is EXPECTED behavior from the hardware during intentional failure tests.

CONTEXT YOU MUST RESPECT:

We are intentionally testing failure scenarios:

1) Product One (PHP5) + user inserts PHP10
   → This is an INTENTIONAL OVERPAYMENT
   → The correct result is: FAILED / INVALID
   → Even if insertedAmount is reported as 0

2) Product Two (PHP10) + user inserts PHP5
   → This is an INTENTIONAL UNDERPAYMENT
   → The correct result is: FAILED / INSUFFICIENT
   → Inserted may be 0 or 5 depending on hardware timing

DO NOT assume:
- insertedAmount === 0 → INSUFFICIENT
This assumption is WRONG in overpayment tests.

AUTHORITATIVE DECISION RULES (NO EXCEPTIONS):

Let:
- price = product price
- attemptedCoin = last detected coin value OR known test intent

Classification MUST be:

- SUCCESS / VALID:
  exact payment matches price

- FAILED / INVALID:
  attemptedCoin > price   (OVERPAYMENT)

- FAILED / INSUFFICIENT:
  attemptedCoin < price   (UNDERPAYMENT)

IMPORTANT:
Numeric INTENT overrides insertedAmount.
insertedAmount is NOT the decision source when hardware aborts the session.

ADDITIONAL REQUIREMENTS:

- NEVER downgrade INVALID to INSUFFICIENT just because insertedAmount is 0
- Do NOT use fallback defaults when state resets
- Preserve or infer attempted coin value for failure classification

PIR COUNTER ISSUE (ALSO FIX):

- PIR entry count must be monotonic
- It must NEVER jump backwards to zero
- Stale API reads or reconnections must NOT overwrite newer counts
- Each physical entry attempt must increment the counter exactly once

WHAT NOT TO CHANGE:
- Arduino logic is correct
- Bluetooth behavior is correct
- UI rendering is not the issue

YOUR TASK:
Refactor the dashboard logic to:
- Stop treating inserted=0 as insufficient by default
- Correctly classify INVALID vs INSUFFICIENT using intent-based rules
- Stabilize PIR entry count so it never resets unexpectedly
``