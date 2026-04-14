❌ Critical Problems in Your Code
1. ❌ Wrong payment logic (biggest issue)
if (product == PRODUCT_ONE) {
  return grams >= 5.0f;
}
return grams >= 2.0f;

👉 This is incorrect:

You’re comparing weight directly to price
5g ≠ ₱5
2g ≠ ₱10

💥 This will accept wrong coins

2. ❌ No coin classification

Right now:

float grams = readCoinWeight();
bool verified = paymentVerifiedFor(product, grams);

👉 You’re skipping:

Detect coin type (₱5 or ₱10)
Then convert to value
3. ❌ Only reads ONE coin

👉 Real usage:

Users insert multiple coins
Your code reads only once → breaks system
✅ Fixed Core Idea

You need:

Detect coin weight
Convert → coin value
Accumulate total
Check if enough
🔥 FIXED VERSION (core logic)
✅ Step 1: classify coin
int getCoinValue(float w) {
  if (w >= 7.15 && w <= 7.75) return 5;
  if (w >= 8.45 && w <= 9.05) return 10;
  return 0; // invalid
}
✅ Step 2: proper payment logic
int requiredAmount(ProductId product) {
  if (product == PRODUCT_ONE) return 5;
  return 10;
}
✅ Step 3: handle multiple coins (IMPORTANT)

Replace your loop logic with this:

int total = 0;
int required = requiredAmount(product);

while (total < required) {
  float grams = readCoinWeight();

  if (grams < 6.5) continue; // ignore noise

  int coinValue = getCoinValue(grams);

  if (coinValue > 0) {
    total += coinValue;

    Serial.print("Coin Detected: ");
    Serial.print(grams, 1);
    Serial.print("g -> PHP");
    Serial.print(coinValue);
    Serial.println(" ACCEPTED");

  } else {
    Serial.print("Coin Detected: ");
    Serial.print(grams, 1);
    Serial.println("g -> INVALID");
  }

  delay(1000); // wait for next coin
}
✅ Step 4: final result
if (total >= required) {
  sendLine("Payment OK");
} else {
  emitMoreCoins();
}
⚙️ Optional (but VERY GOOD)
Add balance display
Serial.print("Inserted: PHP");
Serial.println(total);
🧠 What You Fixed
✅ Correct coin detection (₱5 vs ₱10)
✅ No more fake acceptance
✅ Supports multiple coins
✅ Matches your UI ("Coin Detected: 7.3g → PHP5")
🧾 Final Verdict

👉 Your original code = good structure, wrong logic
👉 Fixed version = real working system




########################
/*
  SmartPay Arduino Example Sketch
  Serial Protocol (9600 baud, newline-delimited)

  Messages:
  - SmartPay Ready
  - Entry: <number>
  - Customer Entered
  - Product Removed. Pay Product One (PHP5).
  - Product Removed. Pay Product Two (PHP10).
  - Pay Product One (PHP5)
  - Pay Product Two (PHP10)
  - Coins: <weight>g - OK
*/

const int productOnePrice = 5;
const int productTwoPrice = 10;

bool customerPresent = false;
bool productOneRemoved = false;
bool productTwoRemoved = false;

float totalDue = 0;
float totalPaid = 0;

void setup() {
  Serial.begin(9600);
  Serial.println("SmartPay Ready");
}

void loop() {
  handleSerialInput();
  simulateCoinInput(); // remove later when using real sensor
}

void handleSerialInput() {
  if (Serial.available()) {
    String input = Serial.readStringUntil('\n');
    input.trim();

    // Customer entry
    if (input.startsWith("Entry:")) {
      customerPresent = true;
      Serial.println("Customer Entered");
    }

    // Product events
    if (input.indexOf("Product One Removed") >= 0) {
      productOneRemoved = true;
      totalDue += productOnePrice;
      Serial.println("Product Removed. Pay Product One (PHP5).");
    }

    if (input.indexOf("Product Two Removed") >= 0) {
      productTwoRemoved = true;
      totalDue += productTwoPrice;
      Serial.println("Product Removed. Pay Product Two (PHP10).");
    }
  }
}

// Simulated coin sensor (replace with real load cell later)
void simulateCoinInput() {
  if (!customerPresent) return;

  // Example: fake coin detection every 5 seconds
  static unsigned long lastTime = 0;

  if (millis() - lastTime > 5000 && totalDue > 0) {
    lastTime = millis();

    float fakeCoinWeight = random(1, 10); // simulate grams
    processCoin(fakeCoinWeight);
  }
}

void processCoin(float weight) {
  Serial.print("Coins: ");
  Serial.print(weight);
  Serial.println("g - OK");

  // simple conversion: 1g = PHP1 (example logic)
  totalPaid += weight;

  checkPayment();
}

void checkPayment() {
  if (totalPaid >= totalDue && totalDue > 0) {
    Serial.println("Payment Complete. Thank you!");
    
    // reset system
    resetSystem();
  }
}

void resetSystem() {
  customerPresent = false;
  productOneRemoved = false;
  productTwoRemoved = false;

  totalDue = 0;
  totalPaid = 0;
}