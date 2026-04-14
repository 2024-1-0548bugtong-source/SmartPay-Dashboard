// SmartPay Arduino Sketch
// Hardware:
// - Arduino Nano ATmega328P
// - 20x4 LCD Display with I2C interface
// - HX711 Load Cell Amplifier (x2): 3kg (product), 1kg (coins)
// - PIR Motion Sensor SR501
// - 5V Buzzer (active/passive)
// - HC-05 Bluetooth (optional)

#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <SoftwareSerial.h>
#include "HX711.h"

// ── HC-05 Bluetooth Configuration ─────────────────────────────────────
// Configure these pins for HC-05 communication (must be digital pins that support SoftwareSerial)
// For Arduino Nano: pins 0 and 1 are hardware serial, so we use pins 10 and 11 for software serial
#define HC05_RX_PIN 10    // Connect HC-05 TX to pin 10
#define HC05_TX_PIN 11    // Connect HC-05 RX to pin 11
SoftwareSerial hc05Serial(HC05_RX_PIN, HC05_TX_PIN);  // RX, TX
bool hc05Enabled = true;  // Set to false if HC-05 is not connected

// ── Pins ──────────────────────────────────────────────────────────────

// HX711 Load Cells
#define PRODUCT_CELL_DT 2     // 3kg load cell (product detection)
#define PRODUCT_CELL_SCK 3
#define COIN_CELL_DT 4        // 1kg load cell (coin payment)
#define COIN_CELL_SCK 5

// PIR Motion Sensor
#define PIR_PIN 6

// Buzzer
#define BUZZER_PIN 7

// Waiting-for-payment LED
#define LED_WAITING 13

// LCD I2C address (usually 0x27 or 0x3F, adjust if needed)
#define LCD_I2C_ADDR 0x27
#define LCD_COLS 20
#define LCD_ROWS 4

// ── Weight Thresholds ─────────────────────────────────────────────────

// Product weights (grams) — adjust based on your products
#define PRODUCT_ONE_MIN_WEIGHT 150    // ~Product One (PHP5)
#define PRODUCT_ONE_MAX_WEIGHT 250
#define PRODUCT_TWO_MIN_WEIGHT 50     // ~Product Two (PHP10)
#define PRODUCT_TWO_MAX_WEIGHT 120

// Coin weight thresholds (grams)
#define COIN_DETECT_MIN 6.5f          // Ignore noise below this
#define COIN_RESET_MAX 1.0f           // Coin is considered removed below this
#define COIN_PHP5_MIN 7.15f
#define COIN_PHP5_MAX 7.75f
#define COIN_PHP10_MIN 8.45f
#define COIN_PHP10_MAX 9.05f
#define COIN_STABILIZE_MS 500

// ── State Machine ─────────────────────────────────────────────────────

enum SmState {
  STATE_READY,
  STATE_CUSTOMER_DETECTED,
  STATE_PRODUCT_SELECTED,
  STATE_WAITING_FOR_COIN,
  STATE_COIN_DETECTED,
  STATE_COIN_VALIDATED,
  STATE_PAYMENT_OK,
  STATE_PAYMENT_FAILED,
};

// ── Globals ───────────────────────────────────────────────────────────

LiquidCrystal_I2C lcd(LCD_I2C_ADDR, LCD_COLS, LCD_ROWS);
HX711 productScale;
HX711 coinScale;

SmState currentState = STATE_READY;
unsigned long stateChangeTime = 0;
int entryCount = 0;
int selectedProduct = 0;  // 1 = PHP5, 2 = PHP10
int paidAmount = 0;
int lastCoinValue = 0;
float lastCoinWeight = 0.0f;
float previousCoinWeight = 0.0f;
bool coinLatched = false;

// ── Setup ─────────────────────────────────────────────────────────────

void setup() {
  Serial.begin(9600);
  
  // Initialize HC-05 Bluetooth at 9600 baud (default HC-05 baudrate)
  if (hc05Enabled) {
    hc05Serial.begin(9600);
  }
  
  pinMode(PIR_PIN, INPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_WAITING, OUTPUT);
  digitalWrite(LED_WAITING, LOW);
  
  // Initialize load cells
  productScale.begin(PRODUCT_CELL_DT, PRODUCT_CELL_SCK);
  coinScale.begin(COIN_CELL_DT, COIN_CELL_SCK);

  // Calibration factors (adjust based on your calibration procedure)
  // You may need to run a calibration sketch first
  productScale.set_scale(420.0);    // Adjust this value
  productScale.tare();              // Reset to 0g
  coinScale.set_scale(420.0);       // Adjust this value
  coinScale.tare();                 // Reset to 0g

  // Initialize LCD
  lcd.init();
  lcd.backlight();
  lcd.print("SmartPay Ready");
  
  // Send to serial
  Serial.println("SmartPay Ready");
  
  delay(1000);
  lcd.clear();
}

// ── Loop ──────────────────────────────────────────────────────────────

void loop() {
  bool pirDetected = digitalRead(PIR_PIN) == HIGH;
  float productWeight = productScale.get_units(10);  // Average of 10 readings
  float coinWeight = coinScale.get_units(10);

  // State machine
  switch (currentState) {
    case STATE_READY:
      handleReady(pirDetected);
      break;
    case STATE_CUSTOMER_DETECTED:
      handleCustomerDetected(productWeight, pirDetected);
      break;
    case STATE_PRODUCT_SELECTED:
      handleProductSelected();
      break;
    case STATE_WAITING_FOR_COIN:
      handleWaitingForCoin(coinWeight);
      break;
    case STATE_COIN_DETECTED:
      handleCoinDetected();
      break;
    case STATE_COIN_VALIDATED:
      handleCoinValidated(coinWeight);
      break;
    case STATE_PAYMENT_OK:
      handlePaymentOk();
      break;
    case STATE_PAYMENT_FAILED:
      handlePaymentFailed(coinWeight);
      break;
  }

  // Track previous sensor value for edge-triggered coin detection.
  previousCoinWeight = coinWeight;

  delay(200);  // Debounce delay
}

// ── State Handlers ────────────────────────────────────────────────────

void handleReady(bool pirDetected) {
  digitalWrite(LED_WAITING, LOW);
  if (pirDetected) {
    entryCount++;
    paidAmount = 0;
    selectedProduct = 0;
    coinLatched = false;
    transitionTo(STATE_CUSTOMER_DETECTED);
    
    // Send entry event
    Serial.print("Entry: ");
    Serial.println(entryCount);
    Serial.println("Customer Entered");
    
    lcdShow("Customer", "Entered");
    buzz(150);
  }
}

void handleCustomerDetected(float productWeight, bool pirDetected) {
  if (!pirDetected) {
    // Customer left without buying
    digitalWrite(LED_WAITING, LOW);
    transitionTo(STATE_READY);
    Serial.println("Customer Left");
    lcdShow("SmartPay", "Ready");
    return;
  }

  // Check if product is placed on 3kg scale
  if (productWeight > 40.0f) {  // Threshold to detect product
    // Determine which product
    if (productWeight >= PRODUCT_ONE_MIN_WEIGHT && productWeight <= PRODUCT_ONE_MAX_WEIGHT) {
      selectedProduct = 1;  // Product One (PHP5)
      paidAmount = 0;
      transitionTo(STATE_PRODUCT_SELECTED);
      digitalWrite(LED_WAITING, HIGH);
      Serial.println("Product Removed. Pay Product One (PHP5).");
      lcdShow("Product One", "PHP5");
      buzz(100);
      delay(500);
      buzz(100);
    } else if (productWeight >= PRODUCT_TWO_MIN_WEIGHT && productWeight <= PRODUCT_TWO_MAX_WEIGHT) {
      selectedProduct = 2;  // Product Two (PHP10)
      paidAmount = 0;
      transitionTo(STATE_PRODUCT_SELECTED);
      digitalWrite(LED_WAITING, HIGH);
      Serial.println("Product Removed. Pay Product Two (PHP10).");
      lcdShow("Product Two", "PHP10");
      buzz(100);
      delay(500);
      buzz(100);
    }
  }
}

void handleProductSelected() {
  transitionTo(STATE_WAITING_FOR_COIN);
  digitalWrite(LED_WAITING, HIGH);
  if (selectedProduct == 1) {
    Serial.println("Pay Product One (PHP5)");
    lcdShow("Pay", "Product One");
  } else {
    Serial.println("Pay Product Two (PHP10)");
    lcdShow("Pay", "Product Two");
  }
}

void handleWaitingForCoin(float coinWeight) {
  digitalWrite(LED_WAITING, HIGH);
  // Anti-double count: only detect on edge transition <1g -> >6.5g.
  if (!coinLatched && previousCoinWeight < COIN_RESET_MAX && coinWeight > COIN_DETECT_MIN) {
    coinLatched = true;
    transitionTo(STATE_COIN_DETECTED);
  }
}

void handleCoinDetected() {
  if (millis() - stateChangeTime < COIN_STABILIZE_MS) {
    return;
  }

  // Average multiple samples for stable classification.
  lastCoinWeight = coinScale.get_units(10);
  lastCoinValue = classifyCoin(lastCoinWeight);
  transitionTo(STATE_COIN_VALIDATED);
}

void handleCoinValidated(float coinWeight) {
  bool paymentOk = false;

  if (lastCoinValue > 0) {
    paidAmount += lastCoinValue;
    Serial.print("Coin Detected: ");
    Serial.print(lastCoinWeight, 1);
    Serial.print("g -> PHP");
    Serial.print(lastCoinValue);
    Serial.println(" ACCEPTED");
  } else {
    Serial.print("Coin Detected: ");
    Serial.print(lastCoinWeight, 1);
    Serial.println("g -> INVALID COIN");
  }

  Serial.print("Inserted: PHP");
  Serial.println(paidAmount);

  Serial.print("Remaining: PHP");
  Serial.println(remainingAmount());

  if (paidAmount >= requiredAmount()) {
    paymentOk = true;
  }

  if (paymentOk) {
    transitionTo(STATE_PAYMENT_OK);
    Serial.println("Dispensing Product...");
    Serial.println("Payment OK");
    lcdShow("Payment OK", "Thank you!");
    buzz(200);
    delay(300);
    buzz(200);
    return;
  }

  Serial.println("Add More Coins");
  lcdShow("Add More", "Coins");
  buzz(100);
  transitionTo(STATE_PAYMENT_FAILED);

  // Wait for the coin to clear before accepting the next coin.
  if (coinWeight < COIN_RESET_MAX) {
    coinLatched = false;
  }
}

void handlePaymentOk() {
  digitalWrite(LED_WAITING, LOW);
  // Reset after 3 seconds
  if (millis() - stateChangeTime > 3000) {
    transitionTo(STATE_READY);
    Serial.println("Customer Left");
    Serial.println("SmartPay Ready");
    lcdShow("SmartPay", "Ready");
    coinScale.tare();
    productScale.tare();
  }
}

void handlePaymentFailed(float coinWeight) {
  digitalWrite(LED_WAITING, HIGH);
  // Reset latch once the current coin leaves the scale.
  if (coinWeight < COIN_RESET_MAX) {
    coinLatched = false;
    transitionTo(STATE_WAITING_FOR_COIN);
    return;
  }

  // Timeout if user leaves coins sitting or no valid follow-up happens.
  if (millis() - stateChangeTime > 5000) {
    transitionTo(STATE_READY);
    Serial.println("Customer Left");
    Serial.println("SmartPay Ready");
    lcdShow("SmartPay", "Ready");
    coinScale.tare();
    productScale.tare();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

void transitionTo(SmState newState) {
  currentState = newState;
  stateChangeTime = millis();
}

void lcdShow(const char* line1, const char* line2) {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(line1);
  lcd.setCursor(0, 1);
  lcd.print(line2);
}

void buzz(int duration) {
  digitalWrite(BUZZER_PIN, HIGH);
  delay(duration);
  digitalWrite(BUZZER_PIN, LOW);
}

int requiredAmount() {
  return selectedProduct == 1 ? 5 : 10;
}

int remainingAmount() {
  int rem = requiredAmount() - paidAmount;
  return rem > 0 ? rem : 0;
}

int classifyCoin(float weight) {
  if (weight < COIN_DETECT_MIN) {
    return 0;
  }

  if (weight >= COIN_PHP5_MIN && weight <= COIN_PHP5_MAX) {
    return 5;
  }

  if (weight >= COIN_PHP10_MIN && weight <= COIN_PHP10_MAX) {
    return 10;
  }

  // Includes uncertain zone (7.75g, 8.45g) and out-of-range coins.
  return -1;
}

// ── Calibration Helper (uncomment to run) ──────────────────────────────

/*
void calibrateLoadCells() {
  Serial.println("=== Load Cell Calibration ===");
  Serial.println("Place known weight on product cell and send 'p' to calibrate");
  Serial.println("Place known weight on coin cell and send 'c' to calibrate");
  
  while (true) {
    if (Serial.available()) {
      char cmd = Serial.read();
      if (cmd == 'p') {
        Serial.print("Product cell raw reading: ");
        Serial.println(productScale.get_value(10));
      } else if (cmd == 'c') {
        Serial.print("Coin cell raw reading: ");
        Serial.println(coinScale.get_value(10));
      }
    }
  }
}
*/

// ── HC-05 Helper Function ─────────────────────────────────────────────

void sendMessage(const char* message) {
  // Send to USB serial (dashboard)
  Serial.println(message);
  
  // Send to HC-05 Bluetooth if enabled
  if (hc05Enabled) {
    hc05Serial.println(message);
  }
}
