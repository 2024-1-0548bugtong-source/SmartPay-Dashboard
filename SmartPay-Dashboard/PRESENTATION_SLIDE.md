# SmartPay Hardware Stack (Demo-Ready)

## What We Built

SmartPay combines low-cost hardware with a real-time dashboard to automate product selection, payment verification, and transaction monitoring.

## Core Components

- Arduino Nano (system controller)
- 20x4 LCD with I2C (live user prompts)
- 2x HX711 + load cells (product and payment measurement)
- PIR motion sensor (customer detection)
- Buzzer + D13 LED (status and feedback)
- HC-05 Bluetooth (wireless monitoring)
- Jumper wires + capacitor (stable prototyping and wiring)

## System Flow (30-second summary)

1. Customer detected by PIR
2. Product is placed and identified by weight
3. Customer pays (validated on payment scale)
4. LCD, buzzer, and LED provide instant feedback
5. Transaction is sent to dashboard analytics

## Payment Logic (Current Implementation)

- Product One: 150g to 250g -> PHP10
- Product Two: 50g to 120g -> PHP5
- Coin acceptance:
	- PHP5 coin: ~7.15g to 7.75g
	- PHP10 coin: ~8.45g to 9.05g
- Payment is approved when inserted amount meets or exceeds required price

## Why This Is Presentation-Worthy

- Practical: built with affordable, accessible components
- Reliable: clear feedback loop between hardware and UI
- Scalable: analytics-ready for store-owner insights

---

### Speaker Notes (optional)

"This is our SmartPay hardware architecture. The Arduino coordinates sensors and outputs, while dual load-cell channels separate product detection from payment verification. We added PIR for context awareness, and HC-05 for flexible connectivity to the dashboard. The result is an end-to-end smart checkout prototype that is low-cost, understandable, and ready for live demo."