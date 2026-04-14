# SmartPay HC-05 Setup & Store Owner Deployment Guide

## Part 1: HC-05 Bluetooth Hardware Setup

### Wiring Diagram

```
HC-05 Module (6-pin)
├─ VCC → 5V
├─ GND → GND  
├─ TX → Arduino Nano Pin 10 (HC05_RX_PIN)
├─ RX → Arduino Nano Pin 11 (HC05_TX_PIN) [with voltage divider]
└─ Other pins: KEY, STATE (optional)

Voltage Divider for RX (recommended to protect Arduino):
  HC-05 RX ← 1kΩ resistor ← Arduino Pin 11 (TX)
             └─ GND through 1kΩ resistor
```

### Step-by-Step HC-05 Connection

1. **Power Supply**
   - Connect HC-05 VCC to Arduino 5V
   - Connect HC-05 GND to Arduino GND
   - Use a capacitor (100µF) between VCC and GND for power smoothing

2. **Serial Communication**
   - HC-05 TX → Arduino Pin 10 (can connect directly)
   - HC-05 RX → Arduino Pin 11 (use voltage divider 1kΩ + 1kΩ)
   - Voltage divider step-down: 5V → ~2.5V safe for HC-05 RX

3. **Pairing with Store Owner's Phone/Tablet**
   - Default HC-05 PIN: `1234` or `0000`
   - Device name: `HC-05` (or rename via AT commands)
   - Baud rate: 9600 (standard, pre-configured)

### Testing HC-05 Connection

1. Upload the updated `smartpay-arduino.ino` to your Arduino Nano
2. Open Serial Monitor at 9600 baud
3. You should see: `SmartPay Ready`
4. On your phone, pair with HC-05 (Bluetooth settings)
5. Use a serial terminal app (e.g., Bluetooth Terminal, Serial Bluetooth Terminal)
6. You should receive the same messages: `SmartPay Ready`, transaction data, etc.

---

## Part 2: Dashboard Deployment for Store Owner

### Option A: Deploy to Vercel (Recommended - Simplest)

This is the easiest option for the store owner to access from any device.

#### Step 1: Build the Dashboard

```bash
cd /path/to/SmartPay-Dashboard
pnpm install
pnpm --filter @workspace/smartpay-dashboard run build
```

This creates the static build in `artifacts/smartpay-dashboard/dist/`

#### Step 2: Deploy to Vercel

1. Create a free account at https://vercel.com
2. Install Vercel CLI:
   ```bash
   npm install -g vercel
   ```
3. Deploy from the project root:
   ```bash
   cd /path/to/SmartPay-Dashboard
   vercel
   ```
4. Follow the prompts (select your project, confirm deployment)
5. Vercel will give you a URL like: `https://smartpay-dashboard-xxxxx.vercel.app`
6. Store owner accesses it from any browser at that URL!

**Advantages:**
- ✅ Free tier available
- ✅ Automatic HTTPS
- ✅ Accessible from anywhere
- ✅ No server maintenance
- ✅ Auto-deploys on git push (with GitHub integration)

---

### Option B: Run on Home Network (Local Server)

If you prefer to keep it on your local network:

#### Step 1: Build the Dashboard

```bash
cd /path/to/SmartPay-Dashboard/artifacts/smartpay-dashboard
pnpm build
```

#### Step 2: Serve with a Simple HTTP Server

Option 1 - Using Node.js http-server:
```bash
npm install -g http-server
cd artifacts/smartpay-dashboard/dist
http-server -p 5173 -c-1
```

Option 2 - Using Python:
```bash
cd artifacts/smartpay-dashboard/dist
python3 -m http.server 5173
```

#### Step 3: Share with Store Owner on Same Network

Get your local IP address:
```bash
# Linux/Mac
ifconfig | grep 'inet '

# Windows
ipconfig
```

Store owner accesses it at: `http://<YOUR_LOCAL_IP>:5173`

**Advantages:**
- ✅ No dependency on internet
- ✅ Lower latency
- ✅ Keeps data on local network

**Disadvantages:**
- ❌ Only accessible on same WiFi network
- ❌ Must keep your server running 24/7
- ❌ No HTTPS (poor for public networks)

---

### Option C: Use PM2 for Always-On Server

For persistent server that survives reboots:

```bash
# Install PM2 globally
npm install -g pm2

# Navigate to dist folder and start server with PM2
cd artifacts/smartpay-dashboard/dist
pm2 start "http-server -p 5173 -c-1" --name smartpay-dashboard

# Make it auto-start on system reboot
pm2 startup
pm2 save
```

Check status:
```bash
pm2 status
pm2 logs smartpay-dashboard
```

---

## Part 3: Storing Owner's Permanent Access

### Complete Setup Package for Store Owner

Once deployed, provide the store owner with:

1. **Dashboard URL**
   - Vercel: `https://smartpay-dashboard-xxxxx.vercel.app`
   - Local Network: `http://<YOUR_IP>:5173`

2. **Instructions**
   ```
   1. Open the URL in their web browser (Chrome, Edge, Firefox, Safari)
   2. Click "Connect Arduino" button
   3. If using USB: Select the COM port where Arduino is connected
   4. If using HC-05 Bluetooth: Use a Bluetooth serial app on phone/tablet
   5. Start selling!
   ```

3. **Quick Start Guide** (Print this)
   ```
   SmartPay Dashboard Quick Start
   ─────────────────────────────
   • Open: [Dashboard URL]
   • Click: "Connect Arduino"
   • Select: Your COM port or Bluetooth device
   • Ready: You should see "SmartPay Ready" status
   • Sell: Place product on scale to start checkout
   ```

---

## Part 4: HC-05 Serial Communication Format

The HC-05 receives ALL the same messages as the USB serial connection:

```
SmartPay Ready
Entry: 124
Customer Entered
Product Removed. Pay Product One (PHP5).
Pay Product One (PHP5)
Coin Detected: 7.3g -> PHP5 ACCEPTED
Inserted: PHP5
Remaining: PHP0
Dispensing Product...
Payment OK
SmartPay Ready
```

**Store owner can:**
- Monitor transactions in real-time via Bluetooth
- View device status on their phone
- Receive alerts when coins are invalid
- Track customer interactions

---

## Part 5: Troubleshooting

### HC-05 Not Pairing
- Check voltage divider on RX line (HC-05 RX pin is 3.3V tolerant, not 5V)
- Verify HC-05 has power (red LED should blink)
- Reset HC-05: press HD-05 button for 10 seconds

### Dashboard Not Loading
- **Vercel:** Check internet connection, verify Vercel deployment was successful
- **Local Network:** Verify firewall allows port 5173, check PC IP with `ipconfig`

### Arduino Not Communicating
- Verify Arduino is uploaded with updated sketch (with HC-05 support)
- Check USB cable and COM port selection
- Ensure 9600 baud rate is selected in dashboard

### Data Not Appearing on Bluetooth
- Verify HC-05 is paired to the phone/tablet
- Open Bluetooth serial terminal app on phone
- Check that app is reading from correct device

---

## Part 6: Security Notes

For production/public deployments:

1. **Vercel Deployment:**
   - Consider adding password protection via Vercel environment variables
   - Keep your project repo private on GitHub

2. **Local Network:**
   - Use HTTPS with self-signed certificate: `http-server -S`
   - Only access from trusted devices on your network

3. **HC-05 Bluetooth:**
   - Change default HC-05 PIN via AT commands
   - Keep Bluetooth disabled when not in use

---

## Summary

| Method | Setup Time | Accessibility | Cost | Best For |
|--------|-----------|---|---|----|
| **Vercel** | 10 min | Anywhere (Internet) | Free | Store owner anywhere, shared device |
| **Local Network** | 5 min | Same WiFi | Free | Single location, low latency |
| **PM2 Always-On** | 15 min | Same WiFi 24/7 | Free | Always available, minimal maintenance |

**Recommended:** Start with **Vercel** (Option A) for simplicity, then upgrade to **PM2** if you need local network redundancy.
