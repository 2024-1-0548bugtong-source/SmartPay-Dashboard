# SmartPay Dashboard Analytics - Complete Technical Breakdown

## Overview

Your SmartPay dashboard **automatically calculates all analytics** from the Arduino hardware. No additional sensors are needed. The Arduino's existing **serial messages + timestamps** provide everything the dashboard needs.

---

## Part 1: Hardware Components → Serial Data

### Sensors That Generate Analytics Data

| Component | Generates | Used For |
|-----------|-----------|----------|
| **PIR Motion Sensor (Pin 6)** | "Entry: #" message | Customer count, transaction flow |
| **HX711 Load Cells (Pins 2-7)** | "Product Removed. Pay PHP#" message | Revenue tracking, product identification |
| **HX711 Coin Scale** | "Coin Detected: #g → PHP# ACCEPTED/REJECTED" | Success rate, payment validation |
| **Buzzer (Pin 7)** | Audio sent on state change | Transaction confirmation (tracks timing) |

### Serial Messages That Drive Analytics

Your Arduino sends these messages every transaction:

```
Entry: 124
Customer Entered
Product Removed. Pay Product One (PHP5).
Pay Product One (PHP5)
Coin Detected: 7.3g -> PHP5 ACCEPTED
Inserted: PHP5
Remaining: PHP0
Dispensing Product...
Payment OK ← Revenue recorded here (PHP5)
Customer Left
```

Each message includes:
- **Timestamp** (added by browser when received)
- **Event type** (Entry, Payment OK, etc.)
- **Product code** (PHP5 or PHP10)
- **Coin weight** (validated against thresholds)

---

## Part 2: Dashboard Analytics Calculation

### 📊 Revenue Dashboard Metric

**How It's Calculated:**
```
For each "Payment OK" event:
  Extract the product price from preceding "Product Removed. Pay PHP#" message
  Add to running total
Result: Total PHP amount collected today
```

**Example:**
```
Message: "Product Removed. Pay Product One (PHP5)."
Next message: "Payment OK"
→ Add PHP5 to revenue
```

**Hardware Dependency:**
- ✅ HX711 Load Cells must detect products accurately
- ✅ Weight thresholds in Arduino sketch must be calibrated
- ✅ Serial messages must include correct PHP amount

---

### ✅ Success Rate Dashboard Metric

**How It's Calculated:**
```
Success Rate = (Payment OK events / Total payment attempts) × 100

Payment Attempts = "Payment OK" + "Payment Incomplete/Insufficient" events
```

**Example:**
```
Today's transactions:
- Transaction 1: Payment OK ✓
- Transaction 2: Insufficient Coins ✗
- Transaction 3: Payment OK ✓

Result: 2 successful / 3 attempts = 66%
```

**Hardware Dependency:**
- ✅ Coin scale (HX711 pins 4-5) must detect and validate coins
- ✅ Coin weight thresholds must be calibrated:
  - PHP5: 7.15g - 7.75g
  - PHP10: 8.45g - 9.05g
- ✅ Arduino must send "Payment OK" or "Insufficient Coins" message

---

### ⏱ Average Transaction Time Dashboard Metric

**How It's Calculated:**
```
For each completed transaction:
  Time = Timestamp("Payment OK") - Timestamp("Customer Entered")
  Add to array of transaction times

Avg Time = Sum of all times / Number of transactions (in seconds)
```

**Example:**
```
Transaction 1: 45 seconds
Transaction 2: 52 seconds
Transaction 3: 38 seconds
Average: (45 + 52 + 38) / 3 = 45 seconds
```

**Hardware Dependency:**
- ✅ PIR sensor (Pin 6) must detect "Customer Entered"
- ✅ Buzzer/state change must trigger "Payment OK" message
- ✅ Web Serial connection must capture accurate timestamps

---

### 📅 Today's Events Log

**How It's Calculated:**
```
Filter all messages by:
  - Timestamp date = Today
  - Sort by timestamp ascending
  - Display in transaction table
```

**What's Captured:**
- Entry count (PIR detections)
- Product selections
- Payment amounts
- Coin validation results
- Errors/insufficient coins

**Hardware Dependency:**
- ✅ All sensors generating serial messages
- ✅ 9600 baud rate for stable serial communication

---

### 📈 Transactions Per Hour Chart

**How It's Calculated:**
```
For current day (00:00 to 23:59):
  Group "Payment OK" events by hour
  Count transactions in each hour
  Display as bar chart (last 12 hours + current hour)
```

**Example:**
```
10:00 - 5 transactions
11:00 - 8 transactions
12:00 - 12 transactions (peak)
13:00 - 6 transactions
```

**Hardware Dependency:**
- ✅ Consistent serial messaging
- ✅ System clock accuracy for timestamp grouping

---

### 👥 Customer Entry Count

**How It's Calculated:**
```
Count all "Entry: #" messages today
Plus: Verify via PIR sensor detections
Result: Total unique customers
```

**Hardware Dependency:**
- ✅ PIR motion sensor (Pin 6) must be:
  - Properly calibrated (detection range 3-7m)
  - Mounted pointing at door/entry point
  - Sensitivity adjustment: turn potentiometer on back of SR501
- ✅ Arduino code detects PIR HIGH state and sends "Entry" message

---

### 🟢 Current Status (Ready/Customer Present)

**How It's Calculated:**
```
Last event = Latest serial message in buffer
If last event is:
  "Entry" OR "Product Removed" OR "Coin Detected" → "Customer Present"
  "Customer Left" OR "SmartPay Ready" → "Ready"
```

**Hardware Dependency:**
- ✅ All sensors sending state-change messages
- ✅ Proper Arduino state machine implementation

---

## Part 3: Data Storage & Persistence

### Where Dashboard Stores Data

```
Browser Local Storage (localStorage API)
├── smartpay_transactions (up to 1000 most recent events)
├── smartpay_dark_mode (UI preference)
└── smartpay_pir_counter (daily customer count)
```

### Data Retention

- **Duration:** Until browser cache is cleared
- **Capacity:** ~1000 transaction events
- **Backup:** Export to CSV anytime
- **Persistence:** Survives browser refresh, persists across sessions

### Exporting Data

Dashboard has built-in CSV export:
```
Click "Export CSV" button
Downloads: smartpay_export_YYYY-MM-DD.csv
Columns: Timestamp, Event, Product, Payment Status, Weight, Raw Line
```

---

## Part 4: Required Hardware Configuration

### Minimal Setup for Basic Analytics

For **revenue, success rate, avg time, hourly transactions**:

```
✅ REQUIRED:
- Arduino Nano (9600 baud serial)
- HX711 Load Cell (product scale) → Detect what's sold
- HX711 Load Cell (coin scale) → Validate payment
- Correct weight thresholds calibrated

⚠️ OPTIONAL (Nice to have):
- PIR Sensor → Customer entry count (currently estimated from "Entry" messages)
- LCD Display → Status visibility
- Buzzer → Audible transaction confirmation
```

### Sensor Calibration Checklist

| Sensor | Critical? | Impact If Wrong |
|--------|-----------|-----------------|
| Product Scale Weight Thresholds | **YES** | Wrong product detected = wrong revenue |
| Coin Scale Weight Thresholds | **YES** | Valid coins rejected OR invalid coins accepted |
| Coin Baud Rate (9600) | **YES** | Garbled messages = analytics break |
| PIR Sensitivity | Medium | Missed customers = low entry count |
| Load Cell Calibration Factor | **YES** | Inaccurate weight readings = payment errors |

### Calibration Procedure

1. **Product Scale Calibration:**
   ```
   Uncomment calibrateLoadCells() in setup()
   Upload sketch
   Place known weight on scale (e.g., 200g)
   Note raw reading from Serial Monitor
   scale_factor = raw_reading / actual_weight
   Update: productScale.set_scale(scale_factor)
   Comment out calibrateLoadCells()
   Re-upload
   ```

2. **Coin Scale Calibration:**
   ```
   Same process as product scale
   Test with actual coins:
   - PHP5 coin: ~7.45g
   - PHP10 coin: ~8.75g
   Adjust thresholds in Arduino sketch:
     #define COIN_PHP5_MIN 7.15f
     #define COIN_PHP5_MAX 7.75f
     #define COIN_PHP10_MIN 8.45f
     #define COIN_PHP10_MAX 9.05f
   ```

---

## Part 5: Real-Time vs Historical Analytics

### Real-Time (Current Session)

Dashboard recalculates metrics in real-time as messages arrive:
- Revenue updates immediately after "Payment OK"
- Success rate updates after each payment attempt
- Avg time updates after each customer leaves
- Hourly chart updates every transaction

### Historical (Previous Days)

To access previous day's analytics:

**Option 1: Manual CSV Export**
```
Today: Export CSV → Save as "smartpay_2024-04-13"
Tomorrow: New data starts from 0:00
```

**Option 2: Backend Database (Not Implemented Yet)**
```
Would need:
- Node.js API server
- SQLite or PostgreSQL database
- Dashboard API integration
- Benefits: Multi-day trends, cloud backup
```

---

## Part 6: Troubleshooting Analytics

### Problem: Revenue Shows 0 but Payments Completed

**Check:**
1. Open browser console (F12)
2. Check Web Serial messages arriving
3. Look for "Payment OK" messages
4. Verify message includes product price (PHP5 or PHP10)

### Problem: Success Rate Shows Wrong %

**Check:**
1. Verify both successful and failed payment messages arriving
2. Arduino should send:
   - ✓ "Payment OK" (counts as success)
   - ✗ "Insufficient Coins" or timeout (counts as failure)
3. Check coin scale calibration

### Problem: Avg Time Always Shows 0 or Wrong

**Check:**
1. Verify "Customer Entered" message is being sent
2. Verify "Payment OK" or "Customer Left" message sent
3. Check browser timestamp is accurate

### Problem: No Hourly Data Showing

**Check:**
1. Verify "Payment OK" messages arrived today
2. Check browser date/time is correct
3. Verify you're viewing today's data, not historical

---

## Part 7: Future Enhancements

### Easy Additions (No Hardware Changes)

- ✅ Monthly revenue trends
- ✅ Product breakdown (PHP5 vs PHP10 sales)
- ✅ Peak hours analysis
- ✅ Multi-day comparison
- ✅ Failed payment patterns

### Advanced Features (Require Backend)

- Cloud backup of analytics
- Multi-location dashboard
- Real-time alerts (revenue milestones)
- Predictive analytics (busy hours forecasting)
- Integration with POS system

---

## Summary

| Metric | Hardware | Software | Status |
|--------|----------|----------|--------|
| Revenue | HX711 Product Scale | Parse messages, sum PHP | ✅ **Working** |
| Success Rate % | HX711 Coin Scale | Count success/failures | ✅ **Working** |
| Avg Transaction Time | All sensors | Timestamp tracking | ✅ **Working** |
| Today's Events Log | All sensors | Timestamp filtering | ✅ **Working** |
| Hourly Transactions | All sensors | Group by hour | ✅ **Working** |
| Customer Count | PIR Sensor | Count "Entry" messages | ✅ **Working** |
| Current Status | All sensors | Latest event tracking | ✅ **Working** |

**Conclusion:** Your Arduino hardware and dashboard are fully equipped to track all analytics. The system operates **without any additional sensors**. Success depends on:

1. ✅ **Proper sensor calibration** (weight thresholds)
2. ✅ **Stable serial communication** (9600 baud)
3. ✅ **Accurate Arduino state machine** (correct messages)
4. ✅ **Browser Web Serial API support** (Chrome, Edge, etc.)
