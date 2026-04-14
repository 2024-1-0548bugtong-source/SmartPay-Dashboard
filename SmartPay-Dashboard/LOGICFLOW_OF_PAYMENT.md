
⚖️ Final Threshold Logic (₱5 and ₱10)
✅ Recommended weight ranges
Coin	Target Weight	Accept Range
₱5	~7.4g	7.15g – 7.75g
₱10	~8.7g	8.45g – 9.05g

👉 Notice the gap (7.75g → 8.45g)
This prevents misreading = VERY IMPORTANT

🧠 Detection Logic (stable version)

Use this flow:

1. Wait for coin
Detect when weight > ~6g (something landed)
2. Stabilize reading
Wait 300–800 ms
Take average of multiple readings
3. Classify
float w = getStableWeight(); // averaged reading

if (w >= 7.15 && w <= 7.75) {
    value += 5;
}
else if (w >= 8.45 && w <= 9.05) {
    value += 10;
}
else {
    rejectCoin();
}
🔒 Add Anti-Error Logic (VERY IMPORTANT)
1. Detect single coin only
if (w < 6.5) ignore; // too small / noise
2. Prevent double counting

Only count when:

previousWeight < 1g AND currentWeight > 6.5g

👉 Means: coin just arrived

3. Reset after coin leaves
wait until weight < 1g before next detection
⚙️ Optional (but powerful)
Add “uncertain zone”

Reject anything in the gap:

if (w > 7.75 && w < 8.45) {
    rejectCoin(); // unclear coin
}
💡 Calibration Tip (DO THIS)

Don’t trust default values. Instead:

Drop 10 ₱5 coins
Record weights → get average
Do same for ₱10
Adjust ranges slightly
🧾 Final Simple Version

👉 If you want the simplest working version:

if (w > 7.1 && w < 7.8) value += 5;
else if (w > 8.4 && w < 9.1) value += 10;
else rejectCoin();
🚀 Reality Check

With this logic + good mechanical design:

✅ Works for demo/project
✅ Acceptable accuracy
❌ Not bank-level precision (that’s normal)



