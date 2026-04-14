# SmartPay Load Cell Calibration Guide

The HX711 load cells must be calibrated to convert raw readings into accurate weight measurements. This guide walks you through the process.

## Prerequisites

- Both load cells mounted and connected
- Arduino Nano with smartpay-arduino.ino uploaded (with calibration enabled)
- A known reference weight (e.g., 100g, 500g, 1kg calibration weight)
- Serial Monitor at 9600 baud
- A stable surface

## Calibration Steps

### 1. Enable Calibration Mode

In `smartpay-arduino.ino`, uncomment this line in `setup()`:

```cpp
// calibrateLoadCells();  // UNCOMMENT THIS LINE
calibrateLoadCells();    // Now uncommented
```

Then comment out the main loop functions or simply let the calibration run.

### 2. Upload and Open Serial Monitor

```bash
# Replace COM PORT with your Arduino's port (e.g., COM3 or /dev/ttyUSB0)
# In Arduino IDE: Tools > Monitor, set baud rate to 9600
```

### 3. Product Scale Calibration (3kg)

1. Make sure the product scale is empty and at rest
2. Send 'p' in the Serial Monitor and press Enter
3. The sketch will output a raw reading (should be near 0 if tared)
4. Place a known weight on the scale (e.g., 100g or 500g)
5. Send 'p' again
6. Note both readings

**Calculate scale factor:**
```
scale_factor = (final_reading - initial_reading) / known_weight_in_grams

Example:
- Initial reading (empty): 5000
- Final reading (with 100g): 47000
- Difference: 42000
- scale_factor = 42000 / 100 = 420
```

### 4. Coin Scale Calibration (1kg)

Repeat the same process for the coin scale:

1. Make sure coin scale is empty
2. Send 'c' and note the initial reading
3. Place a known weight (e.g., 100g)
4. Send 'c' again
5. Calculate the scale factor the same way

### 5. Update the Sketch

In `smartpay-arduino.ino`, update these lines in `setup()`:

```cpp
// REPLACE THESE VALUES with your calculated scale factors
productScale.set_scale(420.0);    // Update this
coinScale.set_scale(420.0);       // Update this
```

### 6. Disable Calibration Mode

Comment out the calibration line:

```cpp
// calibrateLoadCells();  // Commented out after calibration
```

### 7. Test

- Place your Product One on the product scale → should read ~150-250g
- Place your Product Two on the product scale → should read ~50-120g
- Drop coins on the coin scale → should read correct weight

Then upload and test the full flow.

## Troubleshooting

**Weight readings are unstable or wildly inaccurate:**
- Check HX711 wiring (DT and SCK pins correct?)
- Make sure load cells are level and stable
- Re-calibrate with a more accurate reference weight

**Scale reads negative or always zero:**
- Verify DT/SCK pins match the #define statements
- Check that both HX711 modules have power (5V)

**One scale works, other doesn't:**
- Swap the DT/SCK wires to verify connections
- Try calling `set_scale()` with a different factor (try 1.0 to test)

## Fine-Tuning Product Thresholds

After calibration, measure your actual products and coins:

**Measure Product One (PHP5):**
```
Place on scale → note min/max weight range
Update: PRODUCT_ONE_MIN_WEIGHT and PRODUCT_ONE_MAX_WEIGHT
```

**Measure Product Two (PHP10):**
```
Place on scale → note min/max weight range
Update: PRODUCT_TWO_MIN_WEIGHT and PRODUCT_TWO_MAX_WEIGHT
```

**Measure coins:**
```
Coins for Product One payment → should add up to ≥5.0g
Coins for Product Two payment → should add up to ≥10.0g
Update: COIN_WEIGHT_PHP5_MIN and COIN_WEIGHT_PHP10_MIN
```

## HX711 Library Installation

If you haven't installed the HX711 library:

1. Arduino IDE → Sketch > Include Library > Manage Libraries
2. Search for "HX711" by Bogdan Necula
3. Click Install

Or use PlatformIO:
```
pio lib install "HX711"
```

## Calibration Tips

- Perform calibration on the same surface where the kiosk will operate
- Use calibration weights; bathroom/postal scales are often inaccurate
- Calibrate at the same temperature you'll operate (temperature affects readings)
- Perform multiple passes to ensure consistency
- If scale drifts, recalibrate periodically
