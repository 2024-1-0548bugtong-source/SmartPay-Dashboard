#include <Wire.h>
#include <HX711.h>
#include <Adafruit_LiquidCrystal.h>

// ----- PINS -----
#define PIR_PIN 6
#define PRODUCT_BUTTON 7
#define HX_DT 2
#define HX_SCK 3
#define LED_BLUE 8
#define LED_YELLOW 9
#define LED_ORANGE 10
#define LED_RED 11

HX711 scale;
Adafruit_LiquidCrystal lcd(0);

// ----- PRODUCTS -----
enum ProductId {
  PRODUCT_ONE,
  PRODUCT_TWO
};

const char* productLabel(ProductId product) {
  return product == PRODUCT_ONE
    ? "Product One (PHP5)"
    : "Product Two (PHP10)";
}

// ----- HARDWARE HELPERS -----
bool customerDetected() {
  return digitalRead(PIR_PIN) == HIGH;
}

bool productRemoved() {
  return digitalRead(PRODUCT_BUTTON) == LOW;
}

float readCoinWeight() {
  if (!scale.is_ready()) return 0.0;
  return scale.get_units(3);
}

int getCoinValue(float grams) {
  if (grams >= 7.15 && grams <= 7.75) return 5;
  if (grams >= 8.45 && grams <= 9.05) return 10;
  return 0;
}

int requiredAmount(ProductId product) {
  return product == PRODUCT_ONE ? 5 : 10;
}

// ----- SERIAL EMITTERS -----
void emitReady() {
  lcd.clear();
  lcd.print("SmartPay Ready");
  Serial.println("SmartPay Ready");

  digitalWrite(LED_BLUE, HIGH);
  digitalWrite(LED_YELLOW, LOW);
  digitalWrite(LED_ORANGE, LOW);
  digitalWrite(LED_RED, LOW);
}

void setup() {
  Serial.begin(9600);

  pinMode(PIR_PIN, INPUT);
  pinMode(PRODUCT_BUTTON, INPUT_PULLUP);

  pinMode(LED_BLUE, OUTPUT);
  pinMode(LED_YELLOW, OUTPUT);
  pinMode(LED_ORANGE, OUTPUT);
  pinMode(LED_RED, OUTPUT);

  lcd.begin(16, 2);
  lcd.setBacklight(1);

  scale.begin(HX_DT, HX_SCK);
  scale.set_scale();   // calibration later
  scale.tare();

  emitReady();
}

void loop() {
  static int entryNumber = 1;
  static bool lastPir = false;
  static bool inSession = false;
  static bool payPromptSent = false;
  static bool coinLatched = false;
  static int total = 0;
  static ProductId product = PRODUCT_ONE;

  const bool pir = customerDetected();

  // Start session only on PIR rising edge to prevent repeated skipping/re-entry.
  if (!inSession && pir && !lastPir) {
    inSession = true;
    payPromptSent = false;
    coinLatched = false;
    total = 0;

    Serial.print("Entry: ");
    Serial.println(entryNumber++);
    Serial.println("Customer Entered");

    digitalWrite(LED_BLUE, LOW);
    digitalWrite(LED_YELLOW, HIGH);
  }

  if (!inSession) {
    lastPir = pir;
    delay(100);
    return;
  }

  // End session cleanly if customer leaves.
  if (!pir) {
    Serial.println("Customer Left");
    inSession = false;
    emitReady();
    lastPir = pir;
    delay(150);
    return;
  }

  // Wait for a product removal trigger before asking for payment.
  if (!payPromptSent) {
    if (!productRemoved()) {
      lastPir = pir;
      delay(100);
      return;
    }

    product = PRODUCT_ONE; // replace with selector logic as needed

    Serial.print("Product Removed. Pay ");
    Serial.print(productLabel(product));
    Serial.println(".");

    Serial.print("Pay ");
    Serial.println(productLabel(product));

    digitalWrite(LED_YELLOW, LOW);
    digitalWrite(LED_ORANGE, HIGH);
    payPromptSent = true;
  }

  const int required = requiredAmount(product);
  float grams = readCoinWeight();

  // Edge-triggered coin detection to avoid double counting while coin sits on scale.
  if (!coinLatched && grams > 6.5f) {
    coinLatched = true;
    int value = getCoinValue(grams);

    if (value > 0) {
      total += value;
      Serial.print("Coin Detected: ");
      Serial.print(grams, 1);
      Serial.print("g -> PHP");
      Serial.print(value);
      Serial.println(" ACCEPTED");
      digitalWrite(LED_RED, LOW);
    } else {
      Serial.print("Coin Detected: ");
      Serial.print(grams, 1);
      Serial.println("g -> INVALID COIN");
      Serial.println("Add More Coins");
      digitalWrite(LED_RED, HIGH);
    }

    Serial.print("Inserted: PHP");
    Serial.println(total);

    Serial.print("Remaining: PHP");
    Serial.println(max(0, required - total));

    if (total >= required) {
      Serial.println("Dispensing Product...");
      Serial.println("Payment OK");
      Serial.println("Customer Left");

      digitalWrite(LED_ORANGE, LOW);
      digitalWrite(LED_RED, LOW);
      inSession = false;
      emitReady();
    }
  }

  if (coinLatched && grams < 1.0f) {
    coinLatched = false;
  }

  lastPir = pir;
  delay(120);
}