# HonestPay – How Everything Connects
### Presentation Script (Simple & Straight to the Point)

---

## SLIDE 1 — What is HonestPay?

> "HonestPay is an unmanned payment machine.
> A customer walks up, picks a product, drops coins, and the system handles the rest — no cashier needed."

---

## SLIDE 2 — The Hardware (What's Inside the Box)

> "There are 5 main parts working together:"

| Part | What It Does |
|------|-------------|
| **Arduino Nano** | The brain — runs everything |
| **PIR Sensor** | Detects when a customer walks up |
| **Product Scale (HX711)** | Weighs the product to know what was taken |
| **Coin Scale (HX711)** | Weighs the coins dropped in |
| **LCD Screen** | Shows messages to the customer |

> "Plus a buzzer for sounds and an LED that lights up when waiting for payment."

---

## SLIDE 3 — How They Communicate (The Connection)

> "All sensors talk to the Arduino through wires (pins).
> The Arduino then sends text messages through USB serial to the computer — at 9600 baud (that's just the speed)."

```
PIR Sensor ──────────────────────────────┐
Product Scale (HX711) ──────────────────►  Arduino Nano  ──── USB ──── Computer / Dashboard
Coin Scale (HX711) ──────────────────────┘     │
                                               │
                                            LCD Screen
                                            Buzzer
                                            LED
```

> "The computer runs our dashboard website. It reads the Arduino's messages in real time using Web Serial — a browser feature that lets websites read from USB devices."

---

## SLIDE 4 — Step-by-Step Flow (What Happens When a Customer Arrives)

> "Here's the exact sequence, from start to finish:"

**Step 1 — Idle**
- LCD says: *"HonestPay Ready"*
- Arduino is waiting. PIR sensor is watching for motion.

**Step 2 — Customer Detected**
- PIR sensor fires → Arduino logs: `Entry: 1`
- LCD says: *"Customer Entered"*
- Buzzer beeps once.

**Step 3 — Product Taken**
- Customer lifts product off the scale.
- Product scale detects the weight drop.
- Arduino identifies the product: e.g., *Product One = PHP5*
- LCD says: *"Pay Product One PHP5"*
- Buzzer beeps twice.

**Step 4 — Customer Drops Coins**
- Coin scale detects weight.
- Arduino waits 1 second for coins to settle.
- Checks: is the weight enough for the required price?

**Step 5A — Payment OK**
- Arduino sends: `Payment OK`
- LCD says: *"Payment OK — Thank you!"*
- Buzzer beeps twice (long).
- System resets after 3 seconds.

**Step 5B — Not Enough Coins**
- Arduino sends: `Add More Coins`
- LCD says: *"Add More Coins"*
- Customer has 5 seconds to add more.
- System retries. If still not enough → resets.

**Step 6 — Reset**
- Arduino sends: `Customer Left` → `HonestPay Ready`
- Both scales reset to zero.
- Back to Step 1.

---

## SLIDE 5 — How the Dashboard Gets the Data

> "Everything the Arduino prints over USB, the dashboard reads line by line."

```
Arduino prints:   "Payment OK"
        ↓
USB Serial (9600 baud)
        ↓
Browser Web Serial API
        ↓
Dashboard parses the text
        ↓
Updates: revenue, success rate, transaction log, LCD display, charts
```

> "The data is saved in the browser (localStorage) and also sent to Vercel (cloud) so the store owner can check it anywhere."

---

## SLIDE 6 — Remote Monitoring (Optional: HC-05 Bluetooth)

> "If the store owner doesn't want a cable, we have an HC-05 Bluetooth module.
> It mirrors the same serial messages wirelessly to a phone or tablet."

```
Arduino ──► HC-05 (Bluetooth) ──► Phone/Tablet ──► Dashboard
```

> "Same data. No USB needed. Just pair it like a regular Bluetooth device."

---

## SLIDE 7 — Summary (One Sentence Each)

- **Sensors → Arduino:** Wired connections, Arduino reads them every loop.
- **Arduino → Computer:** USB serial, plain text messages at 9600 baud.
- **Computer → Dashboard:** Web Serial API in the browser, no extra software.
- **Dashboard → Cloud:** Sends transaction data to Vercel API for remote access.
- **Everything is automatic** — no manual input needed once set up.

---

*End of connection script.*
