// HonestPay Production Vending Machine Controller
// Transaction-based state machine with clean serial output
// Board: Arduino Uno/Nano (ATmega328P), Baud: 9600
//
// Pin map:
// HX711 Product DT/SCK: D2/D3
// HX711 Coin DT/SCK: D4/D5
// Buzzer: D6
// HC-05 RX/TX: D11/D12
// Ultrasonic TRIG/ECHO: D9/D10

#include <EEPROM.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <SoftwareSerial.h>
#include "HX711.h"

/* ================= BLUETOOTH ================= */
#define HC05_RX_PIN 11
#define HC05_TX_PIN 12
SoftwareSerial hc05Serial(HC05_RX_PIN, HC05_TX_PIN);
bool hc05Enabled = true;

/* ================= HX711 PINS ================= */
#define PRODUCT_CELL_DT 2
#define PRODUCT_CELL_SCK 3
#define COIN_CELL_DT 4
#define COIN_CELL_SCK 5

HX711 productScale;
HX711 coinScale;

/* ================= EEPROM ================= */
#define EEPROM_PRODUCT_SCALE_ADDR 0
#define EEPROM_COIN_SCALE_ADDR 4

/* ================= SENSORS ================= */
#define TRIG_PIN 9
#define ECHO_PIN 10
#define BUZZER_PIN 6
#define CHANGE_THRESHOLD 3
const unsigned long ENTRY_COOLDOWN_MS = 3000;
const unsigned long PAYMENT_TIMEOUT_MS = 15000;

/* ================= LCD ================= */
LiquidCrystal_I2C lcd(0x27, 20, 4);

/* ================= STATE MACHINE ================= */
enum TransactionState {
  STATE_IDLE,              // Waiting for product
  STATE_PRODUCT_SELECTED,  // Product detected, waiting for coin
  STATE_WAITING_PAYMENT,   // Coin detected, validating
  STATE_TRANSACTION_COMPLETE  // Result sent, awaiting reset
};

/* ================= GLOBALS ================= */
float productScaleFactor = 724.0;
float coinScaleFactor = 420.0;

// Entry system
long baseline = 0;
bool personDetected = false;
unsigned long lastEntryEventMs = 0;
int entryCounter = 0;

// Payment state machine
TransactionState currentState = STATE_IDLE;
int currentProductType = 0;
int requiredAmount = 0;
int insertedAmount = 0;
int lastCoinValue = 0;
unsigned long transactionStartMs = 0;
bool transactionResultSent = false;

// Tracking previous sensor readings
int previousProductType = 0;

/* ================= FUNCTION DECLARATIONS ================= */
void handleCalibrationInputs();
void processCalibrationCommand(String cmd);
void loadCalibration();
void sendMessage(const char* msg);
int detectProduct(float weight);
int detectCoin(float weight);
void updateLCD(int productType, int coinValue, const char* statusMsg);
float getStableWeight(HX711 &scale);
const char* productLabelFromType(int productType);
int productPriceFromType(int productType);
void updatePaymentStateMachine(int productType, int coinValue, float coinW);
void emitTransactionResult(int productType, bool success, const char* reason);
long getDistance();
void beepTwice();

/* ================= SETUP ================= */
void setup() {
  Serial.begin(9600);
  if (hc05Enabled) hc05Serial.begin(9600);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  delay(1000);

  // Calibrate ultrasonic baseline
  long sum = 0;
  for (int i = 0; i < 5; i++) {
    sum += getDistance();
    delay(100);
  }
  baseline = sum / 5;

  // Initialize scales
  productScale.begin(PRODUCT_CELL_DT, PRODUCT_CELL_SCK);
  coinScale.begin(COIN_CELL_DT, COIN_CELL_SCK);
  productScale.set_scale(420.0);
  coinScale.set_scale(420.0);
  productScale.tare();
  coinScale.tare();

  // Initialize LCD
  lcd.init();
  lcd.backlight();
  loadCalibration();

  productScale.set_scale(productScaleFactor);
  coinScale.set_scale(coinScaleFactor);
  productScale.tare();
  coinScale.tare();

  sendMessage("HonestPay Ready");
  updateLCD(0, 0, "Ready");

  currentState = STATE_IDLE;
  transactionResultSent = false;
}

long getDistance() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 30000); // timeout
  if (duration == 0) return -1;

  return duration * 0.034 / 2;
}

void beepTwice() {
  for (int i = 0; i < 2; i++) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(150);
    digitalWrite(BUZZER_PIN, LOW);
    delay(150);
  }
}
  /*=======end of door sensor setup======*/

/* ================= MAIN LOOP ================= */
void loop() {
  handleCalibrationInputs();

  // ═══════════════════════════════════════
  // ENTRY SYSTEM (Independent)
  // ═══════════════════════════════════════
  long distance = getDistance();
  if (distance >= 0) {
    unsigned long nowMs = millis();
    if ((baseline - distance) > CHANGE_THRESHOLD &&
        !personDetected &&
        (nowMs - lastEntryEventMs) >= ENTRY_COOLDOWN_MS) {
      beepTwice();
      personDetected = true;
      lastEntryEventMs = nowMs;
      entryCounter++;

      char entryMsg[32];
      snprintf(entryMsg, sizeof(entryMsg), "EVENT:CUSTOMER_ENTERED:%d", entryCounter);
      sendMessage(entryMsg);
    }

    if ((baseline - distance) <= 1 && personDetected) {
      personDetected = false;
      sendMessage("EVENT:CUSTOMER_LEFT");
    }
  }

  delay(100);

  // ═══════════════════════════════════════
  // PAYMENT STATE MACHINE
  // ═══════════════════════════════════════
  float productW = getStableWeight(productScale);
  float coinW = getStableWeight(coinScale);

  int productType = detectProduct(productW);
  int coinValue = detectCoin(coinW);

  updatePaymentStateMachine(productType, coinValue, coinW);

  // Timeout detection: if waiting payment for too long, fail transaction
  if (currentState == STATE_WAITING_PAYMENT &&
      (millis() - transactionStartMs) > PAYMENT_TIMEOUT_MS &&
      !transactionResultSent) {
    emitTransactionResult(currentProductType, false, "INSUFFICIENT");
    transactionResultSent = true;
    currentState = STATE_TRANSACTION_COMPLETE;
  }

  // Reset state when product removed
  if (previousProductType > 0 && productType == 0 && currentState == STATE_TRANSACTION_COMPLETE) {
    currentState = STATE_IDLE;
    currentProductType = 0;
    requiredAmount = 0;
    insertedAmount = 0;
    lastCoinValue = 0;
    transactionResultSent = false;
  }

  // Update UI
  char statusMsg[32] = "Ready";
  if (currentState == STATE_PRODUCT_SELECTED) snprintf(statusMsg, sizeof(statusMsg), "Waiting Coin");
  else if (currentState == STATE_WAITING_PAYMENT) snprintf(statusMsg, sizeof(statusMsg), "Validating");
  else if (currentState == STATE_TRANSACTION_COMPLETE) snprintf(statusMsg, sizeof(statusMsg), "Complete");

  updateLCD(productType, coinValue, statusMsg);

  previousProductType = productType;
  delay(500);
}

/* ================= PAYMENT STATE MACHINE ================= */
void updatePaymentStateMachine(int productType, int coinValue, float coinW) {
  // TRANSITION: No product → Idle
  if (productType == 0) {
    if (currentState != STATE_IDLE && currentState != STATE_TRANSACTION_COMPLETE) {
      // Product removed without completing transaction
      if (!transactionResultSent && currentState == STATE_WAITING_PAYMENT) {
        emitTransactionResult(currentProductType, false, "INSUFFICIENT");
        transactionResultSent = true;
      }
    }
    return;
  }

  // TRANSITION: Product detected, not in checkout
  if (productType > 0 && previousProductType == 0 && currentState == STATE_IDLE) {
    currentState = STATE_PRODUCT_SELECTED;
    currentProductType = productType;
    requiredAmount = productPriceFromType(productType);
    insertedAmount = 0;
    lastCoinValue = 0;
    transactionStartMs = millis();
    transactionResultSent = false;
    coinScale.tare();
    return;
  }

  // TRANSITION: Coin detected in PRODUCT_SELECTED state
  if (currentState == STATE_PRODUCT_SELECTED && coinValue > 0 && lastCoinValue == 0) {
    currentState = STATE_WAITING_PAYMENT;
    transactionStartMs = millis();

    // Validate coin immediately
    if (coinValue != requiredAmount) {
      // Wrong coin value
      emitTransactionResult(currentProductType, false, "INVALID");
      transactionResultSent = true;
      currentState = STATE_TRANSACTION_COMPLETE;
    } else {
      // Valid coin
      insertedAmount += coinValue;
      if (insertedAmount >= requiredAmount) {
        // Payment successful
        emitTransactionResult(currentProductType, true, "VALID");
        transactionResultSent = true;
        currentState = STATE_TRANSACTION_COMPLETE;
      }
    }
    return;
  }

  // TRANSITION: Invalid weight detected (coin present but not recognized)
  if (currentState == STATE_PRODUCT_SELECTED && coinValue == 0 && lastCoinValue == 0 && coinW > 0 && coinW < 35) {
    emitTransactionResult(currentProductType, false, "INVALID");
    transactionResultSent = true;
    currentState = STATE_TRANSACTION_COMPLETE;
    return;
  }

  lastCoinValue = coinValue;
}

/* ================= EMIT FINAL TRANSACTION RESULT ================= */
void emitTransactionResult(int productType, bool success, const char* reason) {
  char result[64];
  const char* productLabel = productLabelFromType(productType);
  
  if (success) {
    int pricePhp = productPriceFromType(productType);
    snprintf(result, sizeof(result), "TRANSACTION:SUCCESS:%s:PHP%d", productLabel, pricePhp);
  } else {
    snprintf(result, sizeof(result), "TRANSACTION:FAILED:%s:%s", productLabel, reason);
  }

  sendMessage(result);
}

/* ================= CALIBRATION HANDLERS ================= */
void handleCalibrationInputs() {
  if (Serial.available()) {
    processCalibrationCommand(Serial.readStringUntil('\n'));
  }

  if (hc05Enabled && hc05Serial.available()) {
    processCalibrationCommand(hc05Serial.readStringUntil('\n'));
  }
}

void processCalibrationCommand(String cmd) {
  cmd.trim();

  // TARE
  if (cmd == "T") {
    productScale.tare();
    coinScale.tare();
    sendMessage("Scales ZEROED");
  }
  // PRODUCT CALIBRATION (P200)
  else if (cmd.startsWith("P")) {
    float knownWeight = cmd.substring(1).toFloat();
    long raw = productScale.get_value(20);
    productScaleFactor = raw / knownWeight;
    productScale.set_scale(productScaleFactor);

    sendMessage("Product calibrated");
  }
  // COIN CALIBRATION (C7.4)
  else if (cmd.startsWith("C")) {
    float knownWeight = cmd.substring(1).toFloat();
    long raw = coinScale.get_value(20);
    coinScaleFactor = raw / knownWeight;
    coinScale.set_scale(coinScaleFactor);

    sendMessage("Coin calibrated");
  }
  // SAVE EEPROM
  else if (cmd == "S") {
    EEPROM.put(EEPROM_PRODUCT_SCALE_ADDR, productScaleFactor);
    EEPROM.put(EEPROM_COIN_SCALE_ADDR, coinScaleFactor);
    sendMessage("Calibration SAVED");
  }
}

/* ================= EEPROM ================= */
void loadCalibration() {
  EEPROM.get(EEPROM_PRODUCT_SCALE_ADDR, productScaleFactor);
  EEPROM.get(EEPROM_COIN_SCALE_ADDR, coinScaleFactor);

  if (productScaleFactor < 100 || coinScaleFactor < 100) {
    productScaleFactor = 420.0;
    coinScaleFactor = 420.0;
  }
}

/* ================= UTIL ================= */
void sendMessage(const char* msg) {
  Serial.println(msg);
  if (hc05Enabled) hc05Serial.println(msg);
}

/* ================= PRODUCT DETECTION ================= */
int detectProduct(float weight) {
  if (weight > 330 && weight < 400) return 1; // ~200g
  if (weight > 650 && weight < 750) return 2; // ~400g
  return 0; // no product / unknown
}

/* ================= COIN DETECTION ================= */
int detectCoin(float weight) {
  if (weight >= 35 && weight <= 38) return 5;   // ₱5
  if (weight >= 40 && weight <= 50) return 10;  // ₱10
  return 0; // no coin
}

/* ================= STABLE READING ================= */
float getStableWeight(HX711 &scale) {
  float total = 0;
  for (int i = 0; i < 3; i++) {
    total += scale.get_units(5);
  }
  float weight = total / 3;
  if (weight < 0) return 0;
  return weight;
}

const char* productLabelFromType(int productType) {
  if (productType == 1) return "P1";
  if (productType == 2) return "P2";
  return "UNKNOWN";
}

int productPriceFromType(int productType) {
  if (productType == 1) return 5;
  if (productType == 2) return 10;
  return 0;
}

/* ================= LCD DISPLAY ================= */
void updateLCD(int productType, int coinValue, const char* statusMsg) {
  lcd.setCursor(0, 0);
  lcd.print("HonestPay        ");

  lcd.setCursor(0, 1);
  if (productType == 1) {
    lcd.print("P1: PHP5         ");
  } else if (productType == 2) {
    lcd.print("P2: PHP10        ");
  } else {
    lcd.print("No Product       ");
  }

  lcd.setCursor(0, 2);
  if (coinValue == 5) {
    lcd.print("Coin: PHP5       ");
  } else if (coinValue == 10) {
    lcd.print("Coin: PHP10      ");
  } else {
    lcd.print("Insert Coin      ");
  }

  lcd.setCursor(0, 3);
  int len = strlen(statusMsg);
  int padding = (20 - len) / 2;
  for (int i = 0; i < padding; i++) lcd.print(" ");
  lcd.print(statusMsg);
  for (int i = padding + len; i < 20; i++) lcd.print(" ");
}
