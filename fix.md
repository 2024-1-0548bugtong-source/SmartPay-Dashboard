/**
 * SYSTEM CONTRACT: HARDWARE ↔ DASHBOARD SYNC + SIMPLIFIED LOGIC
 *
 * This project connects Arduino hardware to a dashboard.
 * All logic must remain consistent across:
 * Arduino → Node.js → API → Dashboard UI
 *
 * =========================================
 * CORE RULE: SINGLE SOURCE OF TRUTH
 * =========================================
 * Hardware messages define the truth.
 * Dashboard must ONLY reflect hardware state.
 * Do not invent or duplicate logic in the UI.
 *
 * =========================================
 * STATE MACHINE (LIMIT LOGIC)
 * =========================================
 * The entire dashboard must only use 4 states:
 *
 * 1. IDLE
 *    → "HonestPay Ready"
 *
 * 2. WAITING (product selected)
 *    Trigger: product removed
 *    → "Product Removed → Product One (PHP5)"
 *    → "Product Removed → Product Two (PHP10)"
 *    → "Inserted Balance"
 *
 * 3. VALIDATING (coin detected)
 *    → "Coin Detected: <weight>g → PHP<value>"
 *
 * 4. RESULT
 *
 *    SUCCESS:
 *      → "Payment OK"
 *      → "Dispensing Product..."
 *
 *    INVALID:
 *      → "Invalid Coin"
 *      → "payment status: Insufficient"
 *
 *    NO COIN:
 *      → "Invalid Coin"
 *      → "payment status: No coin detected"
 *
 * =========================================
 * HARDWARE → DASHBOARD MAPPING
 * =========================================
 *
 * P1 → Product One → PHP5
 * P2 → Product Two → PHP10
 *
 * PAYMENT SUCCESS → "Payment OK"
 * PAYMENT INVALID → "Invalid Coin"
 *
 * =========================================
 * VALIDATION RULES
 * =========================================
 *
 * Product P1 requires PHP5
 * Product P2 requires PHP10
 *
 * IF coin matches expected value:
 *   → SUCCESS
 *
 * IF coin value is wrong:
 *   → INVALID (Insufficient)
 *
 * IF no coin inserted:
 *   → INVALID (No coin detected)
 *
 * =========================================
 * UI RULES (VERY IMPORTANT)
 * =========================================
 *
 * 1. Only ONE state can be active at a time
 * 2. Do NOT show multiple conflicting messages
 * 3. Remove unnecessary UI messages like:
 *    - "Remaining"
 *    - duplicate "Inserted Balance"
 *    - mixed success + invalid at same time
 *
 * 4. Convert UI into a SINGLE EVENT LOG:
 *
 * Example:
 * [1] Product Removed → Product One (PHP5)
 * [2] Coin Detected → PHP10
 * [3] Invalid Coin
 *
 * =========================================
 * INSTRUCTION FOR COPILOT
 * =========================================
 *
 * Refactor the dashboard into a strict 4-state machine.
 * Ensure all UI messages follow hardware logic exactly.
 * Prevent duplicate, overlapping, or out-of-order events.
 * Keep message wording consistent across all layers.
 * If hardware changes, update dashboard logic accordingly.
 */