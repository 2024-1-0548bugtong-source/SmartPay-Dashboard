# SmartPay Arduino Serial Protocol

This dashboard expects one newline-delimited serial message per event at `9600` baud.

**Production Sketch:** [smartpay-arduino.ino](smartpay-arduino.ino) — fully integrated with HX711 load cells, PIR sensor, LCD display, and buzzer feedback.

**Simple Example:** [arduino-smartpay-example.ino](arduino-smartpay-example.ino) — template with stubs for custom implementations.

## Hardware Setup

- **Product Scale (3kg):** HX711 on pins 2 (DT), 3 (SCK) — detects product selection
- **Coin Scale (1kg):** HX711 on pins 4 (DT), 5 (SCK) — verifies payment
- **PIR Sensor:** Pin 6 — detects customer presence
- **Buzzer:** Pin 7 — audio feedback
- **LCD 20x4 I2C:** Displays status (default I2C address 0x27)
- **Arduino Nano:** Main controller, 9600 baud serial

## Calibration

Before running, calibrate both load cells:

1. Uncomment the `calibrateLoadCells()` call in `setup()`
2. Upload and open Serial Monitor at 9600 baud
3. Place a known weight on the product scale and send 'p' to log raw readings
4. Divide the reading by the weight (in grams) to get the `scale_factor`
5. Repeat for the coin scale with 'c'
6. Update the `set_scale()` values in the sketch
7. Comment out calibration and re-upload

## Product Weight Thresholds

Adjust these in the sketch based on your products:

```cpp
#define PRODUCT_ONE_MIN_WEIGHT 150    // Product One (PHP5)
#define PRODUCT_ONE_MAX_WEIGHT 250
#define PRODUCT_TWO_MIN_WEIGHT 50     // Product Two (PHP10)
#define PRODUCT_TWO_MAX_WEIGHT 120
```

## Product Catalog

- `Product One (PHP5)`
- `Product Two (PHP10)`

## Required Messages

Send these exact messages, or compatible variants that preserve the product price:

- `SmartPay Ready`
- `Entry: <number>`
- `Customer Entered`
- `Product Removed. Pay Product One (PHP5).`
- `Product Removed. Pay Product Two (PHP10).`
- `Pay Product One (PHP5)`
- `Pay Product Two (PHP10)`
- `Coin Detected: <weight>g -> PHP5 ACCEPTED`
- `Coin Detected: <weight>g -> PHP10 ACCEPTED`
- `Coin Detected: <weight>g -> INVALID COIN`
- `Inserted: PHP<amount>`
- `Remaining: PHP<amount>`
- `Add More Coins`
- `Dispensing Product...`
- `Payment OK`
- `Customer Left`

## Example Checkout Flow

```text
SmartPay Ready
Entry: 124
Customer Entered
Product Removed. Pay Product One (PHP5).
Pay Product One (PHP5)
Coin Detected: 7.3g -> PHP5 ACCEPTED
Inserted: PHP5
Remaining: PHP0
Dispensing Product...
Payment OK
SmartPay Ready
```

```text
SmartPay Ready
Entry: 202
Customer Entered
Product Removed. Pay Product Two (PHP10).
Pay Product Two (PHP10)
Coin Detected: 7.3g -> PHP5 ACCEPTED
Inserted: PHP5
Remaining: PHP5
Add More Coins
Coin Detected: 7.9g -> INVALID COIN
Inserted: PHP5
Remaining: PHP5
Add More Coins
Coin Detected: 8.8g -> PHP10 ACCEPTED
Inserted: PHP15
Remaining: PHP0
Dispensing Product...
Payment OK
SmartPay Ready
```

## Notes

- Keep each message on its own line.
- The dashboard accepts both the friendly product labels above and the older price-only style like `Pay PHP5` or `Pay PHP10`.
- If you are driving the LCD too, keep the text concise because the dashboard trims to 16 characters per line.