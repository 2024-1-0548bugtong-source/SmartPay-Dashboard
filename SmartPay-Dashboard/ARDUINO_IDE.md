#include "HX711.h"
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// Product scale
HX711 scale_product;
#define DT1 4
#define SCK1 5

// Coin/payment scale
HX711 scale_coin;
#define DT2 6
#define SCK2 7

// Buzzer pin
#define BUZZER_PIN 8

// Calibration factors (adjust BOTH!)
float cal_product = 7050;
float cal_coin = 2000; // <-- you must calibrate this
float lastWeight = 0;
float lastProductSample = 0;
float lastCoinSample = 0;
int totalCoins = 0;

LiquidCrystal_I2C lcd(0x27, 24, 4);
const uint8_t LCD_COLS = 24;

int requiredCoins = 0;
// Reset and detection state
bool paymentDone = false;      // Tracks if current payment is completed
unsigned long paymentTime = 0; // Timestamp for delay after payment
unsigned long lastCoinDetectTime = 0;

const float COIN_NOISE_THRESHOLD = 0.8;
const float COIN_RESET_MAX = 1.0;
const unsigned long PAYMENT_RESET_DELAY_MS = 3000;
const unsigned long COIN_DEBOUNCE_MS = 850;
const unsigned long HX711_TIMEOUT_MS = 250;

float absWeight(float value) {
  if (value < 0) return -value;
  return value;
}

float medianOf5(float a, float b, float c, float d, float e) {
  float arr[5] = {a, b, c, d, e};

  for (int i = 0; i < 4; i++) {
    for (int j = i + 1; j < 5; j++) {
      if (arr[j] < arr[i]) {
        float tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
      }
    }
  }

  return arr[2];
}

float safeReadScale(HX711 &scale, byte samples, float fallback, const char *name) {
  if (!scale.wait_ready_timeout(HX711_TIMEOUT_MS)) {
    Serial.print("WARN: ");
    Serial.print(name);
    Serial.println(" HX711 timeout, using fallback");
    return fallback;
  }

  return absWeight(scale.get_units(samples));
}

float readFilteredCoinWeight(float fallback) {
  float s1 = safeReadScale(scale_coin, 3, fallback, "Coin");
  float s2 = safeReadScale(scale_coin, 3, fallback, "Coin");
  float s3 = safeReadScale(scale_coin, 3, fallback, "Coin");
  float s4 = safeReadScale(scale_coin, 3, fallback, "Coin");
  float s5 = safeReadScale(scale_coin, 3, fallback, "Coin");
  return medianOf5(s1, s2, s3, s4, s5);
}

void lcdPrintRow(uint8_t row, const char *text) {
  char line[LCD_COLS + 1];
  size_t len = strlen(text);
  if (len > LCD_COLS) len = LCD_COLS;

  for (uint8_t i = 0; i < LCD_COLS; i++) {
    line[i] = i < len ? text[i] : ' ';
  }
  line[LCD_COLS] = '\0';

  lcd.setCursor(0, row);
  lcd.print(line);
}

void lcdShow(const char *line1, const char *line2) {
  lcdPrintRow(0, line1);
  lcdPrintRow(1, line2);
  lcdPrintRow(2, "");
  lcdPrintRow(3, "");
}

void lcdShowReady() {
  lcdShow("SmartPay Ready", "Ready");
}

void lcdShowPayPrompt(int required) {
  char line2[25];
  snprintf(line2, sizeof(line2), "Please pay PHP%d", required);
  lcdShow("Insert Coins:", line2);
}

void lcdShowAddMoreCoins(int remaining) {
  char line2[25];
  snprintf(line2, sizeof(line2), "Remaining: PHP%d", remaining);
  lcdShow("Add More Coins", line2);
}

void lcdShowPaymentOk() {
  lcdShow("Payment OK!", "Thank you! :)");
}

void beep(unsigned int durationMs) {
  digitalWrite(BUZZER_PIN, HIGH);
  delay(durationMs);
  digitalWrite(BUZZER_PIN, LOW);
}

void beepAcceptedCoin() {
  beep(35);
}

void beepPaymentOk() {
  beep(120);
  delay(80);
  beep(120);
}

void beepStartupTest() {
  beep(60);
  delay(60);
  beep(60);
  delay(60);
  beep(120);
}

int classifyCoinFromDiff(float diff) {
  if ((diff >= 28.15 && diff <= 29.38) ||
      (diff >= 7.50 && diff <= 8.20)) {
    return 5;
  }

  if ((diff >= 58.00 && diff <= 58.85) ||
      (diff >= 8.45 && diff <= 8.90)) {
    return 10;
  }

  return 0;
}

void resetTransaction(bool tareProductScale) {
  totalCoins = 0;
  requiredCoins = 0;
  paymentDone = false;
  paymentTime = 0;
  lastCoinDetectTime = 0;

  scale_coin.tare();
  if (tareProductScale) {
    scale_product.tare();
  }

  lastWeight = 0;
}

void setup() {
  Serial.begin(9600);

  scale_product.begin(DT1, SCK1);
  scale_product.set_scale(cal_product);

  scale_coin.begin(DT2, SCK2);
  scale_coin.set_scale(cal_coin);

  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
  beepStartupTest();

  lcd.init();
  lcd.backlight();

  scale_product.tare();
  scale_coin.tare();

  lcdShowReady();
}

void loop() {
  float productWeight = safeReadScale(scale_product, 10, lastProductSample, "Product");
  float coinWeight = readFilteredCoinWeight(lastCoinSample);
  unsigned long now = millis();

  lastProductSample = productWeight;
  lastCoinSample = coinWeight;

  // Auto-reset after successful payment.
  if (paymentDone && (now - paymentTime >= PAYMENT_RESET_DELAY_MS)) {
    bool canTareProduct = productWeight < 1.0;
    resetTransaction(canTareProduct);
    productWeight = safeReadScale(scale_product, 10, lastProductSample, "Product");
    coinWeight = readFilteredCoinWeight(lastCoinSample);
    lastProductSample = productWeight;
    lastCoinSample = coinWeight;
    lcdShowReady();
  }

  //serial monitor display
  Serial.print("Product: ");
  Serial.print(productWeight, 2);
  Serial.print(" g  |  Coin: ");
  Serial.print(coinWeight, 2);
  Serial.println(" g");

  // 🛒 PRODUCT DETECTION
  if (productWeight >= 13.5 && productWeight <= 15.5) {
    requiredCoins = 10;
  }
  else if (productWeight >= 3.5 && productWeight <= 5.5) {
    requiredCoins = 5;
  }
  else {
    requiredCoins = 0;
  }

  // 🪙 COIN DETECTION (FILTERED + DEBOUNCED)
  float diff = coinWeight - lastWeight;
  if (absWeight(diff) < COIN_NOISE_THRESHOLD) {
    diff = 0;
  }

  bool canDetectCoin = (now - lastCoinDetectTime) >= COIN_DEBOUNCE_MS;
  if (!paymentDone && requiredCoins > 0 && canDetectCoin && diff > 0) {
    int coinValue = classifyCoinFromDiff(diff);
    if (coinValue > 0) {
      totalCoins += coinValue;
      lastCoinDetectTime = now;
      lastWeight = coinWeight;
      beepAcceptedCoin();

      Serial.print("Detected: ");
      Serial.print(coinValue);
      Serial.print(" coins | diff: ");
      Serial.println(diff, 2);
    } else {
      Serial.print("Ignored noisy/invalid diff: ");
      Serial.println(diff, 2);
    }
  }

  // Track drift while idle to keep the reference current.
  if (requiredCoins == 0 || coinWeight < COIN_RESET_MAX) {
    lastWeight = coinWeight;
  }

  // If no product is present and coin tray is near empty, clear stale totals.
  if (!paymentDone && requiredCoins == 0 && coinWeight < COIN_RESET_MAX) {
    totalCoins = 0;
  }

  // 📟 LCD FLOW (dashboard-style)
  if (paymentDone) {
    lcdShowPaymentOk();
  } else if (requiredCoins > 0) {
    if (totalCoins >= requiredCoins) {
      lcdShowPaymentOk();

      // 👉 Activate relay here
      beepPaymentOk();

      paymentDone = true;        // Mark as done
      paymentTime = now;         // Start delay before reset
    } else if (totalCoins > 0) {
      lcdShowAddMoreCoins(requiredCoins - totalCoins);
    } else {
      lcdShowPayPrompt(requiredCoins);
    }
  } else {
    lcdShowReady();
  }

  delay(120);
}

