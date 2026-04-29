// SmartPay Final Production Sketch
// Source of truth: code.md
// Board: Arduino Uno/Nano (ATmega328P), Baud: 9600
//
// Pin map summary:
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
// Keep HC-05 on 11/12 because pin 10 is used by ultrasonic ECHO.
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
#define EEPROM_COIN_SCALE_ADDR    4

/*===========door sensor=========*/
#define TRIG_PIN 9
#define ECHO_PIN 10
#define BUZZER_PIN 6

#define CHANGE_THRESHOLD 3  // how much closer (cm) to trigger

long baseline = 0;
bool personDetected = false;
unsigned long lastEntryEventMs = 0;
const unsigned long ENTRY_COOLDOWN_MS = 3000;

/* ================= LCD ================= */
LiquidCrystal_I2C lcd(0x27, 20, 4);

/* ================= GLOBALS ================= */
float productScaleFactor = 724.0;
float coinScaleFactor = 420.0;

int entryCounter = 0;
int previousProductType = 0;
int lastCoinValue = 0;
int insertedAmount = 0;
int requiredAmount = 0;
bool checkoutActive = false;

/* ================= FUNCTION DECLARATIONS ================= */
void handleCalibrationInputs();
void processCalibrationCommand(String cmd);
void loadCalibration();
void sendMessage(const char* msg);
int detectProduct(float weight);
int detectCoin(float weight);
void updateLCD(int productType, float productW, int coinValue, bool paid, bool invalidCoinState);
float getStableWeight(HX711 &scale);
const char* productLabelFromType(int productType);
int productPriceFromType(int productType);

/* ================= SETUP ================= */
void setup() {
  /*==========door sensor setup=======*/
  Serial.begin(9600);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(BUZZER_PIN, OUTPUT);

  digitalWrite(BUZZER_PIN, LOW);

  delay(1000); // let sensor stabilize

  // 🔹 get baseline distance (average of 5 readings)
  long sum = 0;
  for (int i = 0; i < 2; i++) {
    sum += getDistance();
    delay(100);
  }
  baseline = sum / 2;

  //bluetooth part==========================
  if (hc05Enabled) hc05Serial.begin(9600);

  productScale.begin(PRODUCT_CELL_DT, PRODUCT_CELL_SCK);
  coinScale.begin(COIN_CELL_DT, COIN_CELL_SCK);

  productScale.set_scale(420.0);
  coinScale.set_scale(420.0);

  productScale.tare();
  coinScale.tare();

  lcd.init();
  lcd.backlight();

  loadCalibration();

  productScale.set_scale(productScaleFactor);
  coinScale.set_scale(coinScaleFactor);

  productScale.tare();
  coinScale.tare();

  sendMessage("Honest Pay Ready");
  lcd.print("Honest Pay Ready");
  sendJsonEvent("HonestPay Ready", "Honest Pay Ready");
  //end of bluetooth part=============================
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
    tone(BUZZER_PIN, 1000);  // 🔊 passive buzzer needs tone()
    delay(300);
    noTone(BUZZER_PIN);
    delay(200);
  }
}
  /*=======end of door sensor setup======*/

/* ================= LOOP ================= */
void loop() {
  /*=============door sensor loop====*/
  long distance = getDistance();
  if (distance < 0) return;

  Serial.print("Distance: ");
  Serial.println(distance);

  // 🔥 detect if something is closer than normal
  unsigned long nowMs = millis();
  if (distance > 0 &&
    (baseline - distance) > CHANGE_THRESHOLD &&
    !personDetected &&
    (nowMs - lastEntryEventMs) >= ENTRY_COOLDOWN_MS) {
    beepTwice();
    personDetected = true;
    lastEntryEventMs = nowMs;

    entryCounter++;
    char entryMsg[24];
    snprintf(entryMsg, sizeof(entryMsg), "Entry: %d", entryCounter);
    sendMessage(entryMsg);
    sendJsonEvent("Entry", entryMsg);
    sendMessage("Customer Entered");
    sendJsonEvent("Customer Entered", "Customer Entered");
  }

  // ✅ reset when back to normal
  if ((baseline - distance) <= 1 && personDetected) {
    //Serial.println("✅ Clear again");
    personDetected = false;
  }

  delay(100);
  /*=========== end door sensor loop=====*/

  handleCalibrationInputs();

  float productW = getStableWeight(productScale);
  float coinW = getStableWeight(coinScale);

  // Continuous telemetry so dashboard receives live data even before event transitions.
  char telemetryMsg[64];
  snprintf(telemetryMsg, sizeof(telemetryMsg), "Product: %.2f g | Coin: %.2f g", productW, coinW);
  sendMessage(telemetryMsg);
  sendJsonEvent("Telemetry", telemetryMsg);

  int productType = detectProduct(productW);
  int coinValue = detectCoin(coinW);

  bool paymentOK = false;
  bool invalidCoinState = false;

  if (productType > 0 && previousProductType == 0) {
    checkoutActive = true;
    insertedAmount = 0;
    requiredAmount = productPriceFromType(productType);
    lastCoinValue = 0; // reset edge detector for new checkout session
    coinScale.tare();  // clear residual coin weight from previous attempt

    const char* label = productLabelFromType(productType);
    char promptMsg[80];
    snprintf(promptMsg, sizeof(promptMsg), "Product Removed. Pay %s.", label);
    sendMessage(promptMsg);
    sendJsonEvent("Product Removed", promptMsg);

    char payMsg[64];
    snprintf(payMsg, sizeof(payMsg), "Pay %s", label);
    sendMessage(payMsg);
    sendJsonEvent("Pay", payMsg);
  }

  if (checkoutActive && coinValue > 0 && lastCoinValue == 0) {
    int expectedCoin = requiredAmount;
    if (coinValue != expectedCoin) {
      char invalidCoinMsg[96];
      snprintf(invalidCoinMsg, sizeof(invalidCoinMsg), "Coin Detected: %.1fg -> INVALID COIN", coinW);
      sendMessage(invalidCoinMsg);
        sendJsonEvent("Invalid Coin", invalidCoinMsg);
      sendMessage("Payment Incomplete");
        sendJsonEvent("Invalid Coin", "Payment Incomplete");
      sendMessage("Add More Coins");
        sendJsonEvent("Invalid Coin", "Add More Coins");
      invalidCoinState = true;
    } else {
      char coinDetectedMsg[96];
      snprintf(coinDetectedMsg, sizeof(coinDetectedMsg), "Coin Detected: %.1fg -> PHP%d ACCEPTED", coinW, coinValue);
      sendMessage(coinDetectedMsg);
        sendJsonEvent("Coin Detected", coinDetectedMsg);

      insertedAmount += coinValue;

      char insertedMsg[32];
      snprintf(insertedMsg, sizeof(insertedMsg), "Inserted: PHP%d", insertedAmount);
      sendMessage(insertedMsg);
        sendJsonEvent("Inserted Balance", insertedMsg);

      int remaining = requiredAmount - insertedAmount;
      if (remaining < 0) remaining = 0;

      char remainingMsg[32];
      snprintf(remainingMsg, sizeof(remainingMsg), "Remaining: PHP%d", remaining);
      sendMessage(remainingMsg);
        sendJsonEvent("Remaining", remainingMsg);

      if (remaining == 0) {
        sendMessage("Dispensing Product...");
        sendMessage("Payment OK");
        paymentOK = true;
        checkoutActive = false;
      } else {
        sendMessage("Add More Coins");
      }
    }
  }

  if (checkoutActive && coinValue == 0 && coinW >= 6.5 && lastCoinValue == 0) {
    char invalidCoinMsg[96];
    snprintf(invalidCoinMsg, sizeof(invalidCoinMsg), "Coin Detected: %.1fg -> INVALID COIN", coinW);
    sendMessage(invalidCoinMsg);
      sendJsonEvent("Invalid Coin", invalidCoinMsg);
    sendMessage("Payment Incomplete");
      sendJsonEvent("Invalid Coin", "Payment Incomplete");
    sendMessage("Add More Coins");
      sendJsonEvent("Invalid Coin", "Add More Coins");
    invalidCoinState = true;
  }

  if (previousProductType > 0 && productType == 0) {
    sendMessage("Customer Left");
    sendJsonEvent("Customer Left", "Customer Left");
    sendMessage("Honest Pay Ready");
    sendJsonEvent("HonestPay Ready", "Honest Pay Ready");
    checkoutActive = false;
    insertedAmount = 0;
    requiredAmount = 0;
    lastCoinValue = 0;
  }

  if (checkoutActive && insertedAmount >= requiredAmount && requiredAmount > 0) {
    paymentOK = true;
  }

  Serial.print("Product Weight: ");
  Serial.print(productW, 2);
  Serial.print(" g | ");
  Serial.print("Coin Weight: ");
  Serial.print(coinW, 2);
  Serial.print(" g | ");
  Serial.print("Product Type: ");
  Serial.print(productType);
  Serial.print(" | Coin Value: ");
  Serial.print(coinValue);
  Serial.print(" | Payment: ");
  Serial.println(paymentOK ? "OK" : "NOT OK");

  updateLCD(productType, productW, coinValue, paymentOK, invalidCoinState);

  previousProductType = productType;
  lastCoinValue = coinValue;

  delay(500);
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

void sendJsonEvent(const char* eventName, const char* raw) {
  // Print a compact JSON record to serial and HC-05 for robust parsing by the bridge
  Serial.print("{\"event\":\"");
  Serial.print(eventName);
  Serial.print("\",\"rawLine\":\"");
  Serial.print(raw);
  Serial.print("\",\"timestamp\":\"");
  Serial.print(millis());
  Serial.println("\"}");

  if (hc05Enabled) {
    hc05Serial.print("{\"event\":\"");
    hc05Serial.print(eventName);
    hc05Serial.print("\",\"rawLine\":\"");
    hc05Serial.print(raw);
    hc05Serial.print("\",\"timestamp\":\"");
    hc05Serial.print(millis());
    hc05Serial.println("\"}");
  }
}

/* ================= PRODUCT DETECTION KILO UDJUSTMENT ================= */
int detectProduct(float weight) {
  if (weight > 200 && weight < 400) return 1; // ~200g
  if (weight > 650 && weight < 750) return 2; // ~400g
  return 0; // no product / unknown
}

/* ================= COIN DETECTION KILO UDJUSTMENT ================= */
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
  if (productType == 1) return "Product One (PHP5)";
  if (productType == 2) return "Product Two (PHP10)";
  return "Unknown Product";
}

int productPriceFromType(int productType) {
  if (productType == 1) return 5;
  if (productType == 2) return 10;
  return 0;
}

/* ================= LCD ================= */
void updateLCD(int productType, float productW, int coinValue, bool paid, bool invalidCoinState) {
  lcd.setCursor(0, 0);
  lcd.print("SMART PAY READY   ");

  // PRODUCT LINE
  lcd.setCursor(0, 1);
  if (productType == 1) {
    lcd.print("P1: 200g = P5     ");
  }
  else if (productType == 2) {
    lcd.print("P2: 400g = P10    ");
  }
  else {
    lcd.print("NO PRODUCT        ");
  }

  // COIN LINE
  lcd.setCursor(0, 2);
  if (coinValue == 5) {
    lcd.print("COIN: 5 PESOS     ");
  }
  else if (coinValue == 10) {
    lcd.print("COIN: 10 PESOS    ");
  }
  else if (coinValue < 0) {
    lcd.print("INVALID COIN      ");
  }
  else {
    lcd.print("INSERT COIN       ");
  }

  // STATUS LINE
  lcd.setCursor(0, 3);
  if (paid) {
    lcd.print("PAYMENT SUCCESS   ");
    delay(2000);
    coinScale.tare(); // reset after payment
  }
  else if (invalidCoinState) {
    lcd.print("INVALID COIN      ");
  }
  else {
    lcd.print("WAITING PAYMENT   ");
  }
}


