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
#define EEPROM_COIN_SCALE_ADDR    4

/*===========door sensor=========*/
#define TRIG_PIN 9
#define ECHO_PIN 10
#define BUZZER_PIN 6

#define CHANGE_THRESHOLD 3  // how much closer (cm) to trigger

long baseline = 0;
bool personDetected = false;

/* ================= LCD ================= */
LiquidCrystal_I2C lcd(0x27, 20, 4);

/* ================= GLOBALS ================= */
float productScaleFactor = 724.0;
float coinScaleFactor = 420.0;

/* ================= FUNCTION DECLARATIONS ================= */
void handleCalibrationInputs();
void processCalibrationCommand(String cmd);
void loadCalibration();
void sendMessage(const char* msg);
int detectProduct(float weight);
int detectCoin(float weight);
void updateLCD(int productType, float productW, int coinValue, bool paid);
float getStableWeight(HX711 &scale);

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
  for (int i = 0; i < 5; i++) {
    sum += getDistance();
    delay(100);
  }
  baseline = sum / 5;

 Serial.print("Baseline distance: ");
  Serial.println(baseline);
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

  sendMessage("SmartPay Ready (No Capacitor)");
  lcd.print("SmartPay Ready");
  //end of bluetooth part=============================
}

long getDistance() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 30000);
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

/* ================= LOOP ================= */
void loop() {
  /*=============door sensor loop====*/
  long distance = getDistance();
  if (distance < 0) return;

  Serial.print("Distance: ");
  Serial.println(distance);

  // 🔥 detect if something is closer than normal
  if ((baseline - distance) > CHANGE_THRESHOLD && !personDetected) {
    //Serial.println("🚶 Person detected!");
    beepTwice();
    personDetected = true;
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

  int productType = detectProduct(productW);
  int coinValue = detectCoin(coinW);

  bool paymentOK = false;

  if (productType == 1 && coinValue == 5) paymentOK = true;
  if (productType == 2 && coinValue == 10) paymentOK = true;
  // 🔥 DEBUG OUTPUT (Serial Monitor)
  Serial.print("Product Weight: ");
  Serial.print(productW);
  Serial.print(" g | ");

  Serial.print("Coin Weight: ");
  Serial.print(coinW);
  Serial.print(" g | ");

  Serial.print("Product Type: ");
  Serial.print(productType);

  Serial.print(" | Coin Value: ");
  Serial.print(coinValue);

  Serial.print(" | Payment: ");
  Serial.println(paymentOK ? "OK" : "NOT OK");
  updateLCD(productType, productW, coinValue, paymentOK);

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
  return 0; // invalid / no coin
}

/* ================= STABLE READING ================= */
float getStableWeight(HX711 &scale) {
  float total = 0;
  for (int i = 0; i < 3; i++) {
    total += scale.get_units(5);
  }
  return total / 3;
}

/* ================= LCD ================= */
void updateLCD(int productType, float productW, int coinValue, bool paid) {
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
  else {
    lcd.print("WAITING PAYMENT   ");
  }
}





