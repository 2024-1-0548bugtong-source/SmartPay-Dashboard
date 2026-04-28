Act as a senior full-stack developer and debug my vending machine system (Arduino hardware → serial bridge → web dashboard).

## Problem Overview

My system has inconsistent logic between hardware and dashboard. The hardware correctly outputs payment results (SUCCESS / INVALID), but the dashboard shows incorrect or null payment status, wrong success rate, and incorrect revenue.

## Requirements

### 1. Fix Transaction Logic

Each purchase must be treated as ONE transaction object, not multiple logs.

Structure:

```
{
  product: "P1" | "P2",
  price: number,
  inserted: number,
  weight: number,
  status: "SUCCESS" | "FAILED",
  reason: "VALID" | "INVALID" | "INSUFFICIENT",
  timestamp: Date
}
```

### 2. Payment Rules

* SUCCESS if inserted === price
* FAILED otherwise

Failure types:

* No coin → INSUFFICIENT
* Wrong coin → INVALID
* Less than price → INSUFFICIENT

### 3. Dashboard Fixes

* Payment status must NEVER be null
* Product Two must correctly show "Payment OK - Verified" when success
* Remove intermediate logs like:

  * "Add More Coins"
  * "Customer Left"
  * "Inserted Balance"
* Only log FINAL transaction result

### 4. Success Rate Logic

```
successRate = successTransactions / totalTransactions
```

* FAILED includes BOTH:

  * INVALID
  * INSUFFICIENT
* Ensure insufficient transactions are counted

### 5. Revenue Fix

* Revenue must be dynamic
* Only count SUCCESS transactions
* Remove any hardcoded values

### 6. Clear Logs Fix

When "Clear Logs" is clicked:

* Reset ALL:

  * transaction list
  * success count
  * failure count
  * revenue
* UI and internal state must both reset

### 7. Bridge Fix (Critical)

Ensure the serial bridge:

* Sends FINALIZED transaction only
* Does NOT overwrite success with later events
* Maintains correct event order

### 8. Debug Requirement

* Trace full flow: hardware → serial → backend → frontend
* Identify where payment status becomes null
* Fix race conditions or overwrites

### 9. Code Quality

* Use clean architecture
* Avoid duplicate state
* Ensure single source of truth for transactions
* Add comments explaining logic

## Goal

Make the dashboard 100% reflect hardware truth with correct:

* payment status
* success rate
* revenue
* logs
