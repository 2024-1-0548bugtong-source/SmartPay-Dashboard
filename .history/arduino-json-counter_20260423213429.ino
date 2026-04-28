// Arduino Uno JSON event sender for SmartPay dashboard
// Baud rate must match Node server: 9600

const int PIR_PIN = 7;                     // Change to your sensor pin
const unsigned long EVENT_COOLDOWN_MS = 3000;

bool lastPirState = false;
unsigned long lastSentMs = 0;

void setup() {
  Serial.begin(9600);
  pinMode(PIR_PIN, INPUT);

  // Startup event for debugging/health checks
  Serial.println("{\"event\":\"device_ready\"}");
}

void loop() {
  bool pirState = digitalRead(PIR_PIN) == HIGH;
  unsigned long now = millis();

  // Edge trigger + cooldown to avoid duplicate noisy counts
  if (pirState && !lastPirState && (now - lastSentMs) >= EVENT_COOLDOWN_MS) {
    Serial.println("{\"event\":\"customer_entered\"}");
    lastSentMs = now;
  }

  lastPirState = pirState;

  // Optional tiny delay for stable reads
  delay(30);
}
