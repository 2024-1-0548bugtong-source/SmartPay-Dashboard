#include <EEPROM.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include "HX711.h"

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

/*=========== door sensor ==========*/
#define TRIG_PIN 9
#define ECHO_PIN 10
#define BUZZER_PIN 6
#define CHANGE_THRESHOLD 3  

long baseline = 0;
bool personDetected = false;

/* ================= LCD ================= */
LiquidCrystal_I2C lcd(0x27, 20, 4);

/* ================= GLOBALS ================= */
float productScaleFactor = 724.0;
float coinScaleFactor = 420.0;

int previousProductType = 0;
int lastCoinValue = 0;
int insertedAmount = 0;
int requiredAmount = 0;
bool checkoutActive = false;

/* Telemetry timing */
unsigned long lastTelemetryAt = 0;
const unsigned long TELEMETRY_INTERVAL_MS = 700;

/* ================= SETUP ================= */
void setup() {
  Serial.begin(9600);   // 🔥 Hardware Serial = Bluetooth

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  delay(1000);

  long sum = 0;
  for (int i = 0; i < 5; i++) {
    sum += getDistance();
    delay(100);
  }
  baseline = sum / 5;

  productScale.begin(PRODUCT_CELL_DT, PRODUCT_CELL_SCK);
  coinScale.begin(COIN_CELL_DT, COIN_CELL_SCK);

  productScale.tare();
  coinScale.tare();

  lcd.init();
  lcd.backlight();

  loadCalibration();
  productScale.set_scale(productScaleFactor);
  coinScale.set_scale(coinScaleFactor);

  productScale.tare();
  coinScale.tare();

  sendMessage("{\"status\":\"SmartPay Ready\"}");
}

/* ================= LOOP ================= */
void loop() {
  long distance = getDistance();
  if (distance > 0) {
    if ((baseline - distance) > CHANGE_THRESHOLD && !personDetected) {
      beepTwice();
      personDetected = true;
      sendMessage("{\"event\":\"customer_entered\"}");
    }

    if ((baseline - distance) <= 1 && personDetected) {
      personDetected = false;
    }
  }

  float productW = getStableWeight(productScale);
  float coinW = getStableWeight(coinScale);

  int productType = detectProduct(productW);
  int coinValue = detectCoin(coinW);

  unsigned long now = millis();
  if (now - lastTelemetryAt >= TELEMETRY_INTERVAL_MS) {
    char msg[128];
    snprintf(msg, sizeof(msg),
      "{\"product_w\":%.2f,\"coin_w\":%.2f,\"product\":%d,\"coin\":%d,\"inserted\":%d}",
      productW, coinW, productType, coinValue, insertedAmount
    );
    sendMessage(msg);
    lastTelemetryAt = now;
  }

  if (productType > 0 && previousProductType == 0) {
    checkoutActive = true;
    insertedAmount = 0;
    requiredAmount = productPriceFromType(productType);
  }

  if (checkoutActive && coinValue > 0 && lastCoinValue == 0) {
    insertedAmount += coinValue;
    if (insertedAmount >= requiredAmount) {
      sendMessage("{\"payment\":\"success\"}");
      checkoutActive = false;
      coinScale.tare();
    }
  }

  updateLCD(productType, coinValue, checkoutActive);

  previousProductType = productType;
  lastCoinValue = coinValue;
  delay(200);
}

/* ================= UTIL ================= */
void sendMessage(const char* msg) {
  Serial.println(msg);  // 🔥 Bluetooth output
}

/* ================= SENSORS ================= */
long getDistance() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 8000);
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

/* ================= DETECTION ================= */
int detectProduct(float weight) {
  if (weight > 330 && weight < 400) return 1;
  if (weight > 650 && weight < 750) return 2;
  return 0;
}

int detectCoin(float weight) {
  if (weight >= 35 && weight <= 38) return 5;
  if (weight >= 40 && weight <= 50) return 10;
  return 0;
}

float getStableWeight(HX711 &scale) {
  float t = 0;
  for (int i = 0; i < 3; i++) t += scale.get_units(5);
  return t / 3;
}

int productPriceFromType(int t) {
  if (t == 1) return 5;
  if (t == 2) return 10;
  return 0;
}

/* ================= EEPROM ================= */
void loadCalibration() {
  EEPROM.get(EEPROM_PRODUCT_SCALE_ADDR, productScaleFactor);
  EEPROM.get(EEPROM_COIN_SCALE_ADDR, coinScaleFactor);
  if (productScaleFactor < 100) productScaleFactor = 420.0;
  if (coinScaleFactor < 100) coinScaleFactor = 420.0;
}

/* ================= LCD ================= */
void updateLCD(int productType, int coinValue, bool waiting) {
  lcd.setCursor(0, 0);
  lcd.print("SMART PAY         ");

  lcd.setCursor(0, 1);
  if (productType == 1) lcd.print("P1 = P5           ");
  else if (productType == 2) lcd.print("P2 = P10          ");
  else lcd.print("NO PRODUCT        ");

  lcd.setCursor(0, 2);
  if (coinValue == 5) lcd.print("COIN 5 PESOS      ");
  else if (coinValue == 10) lcd.print("COIN 10 PESOS     ");
  else lcd.print("INSERT COIN       ");

  lcd.setCursor(0, 3);
  lcd.print(waiting ? "WAIT PAYMENT      " : "READY             ");
}