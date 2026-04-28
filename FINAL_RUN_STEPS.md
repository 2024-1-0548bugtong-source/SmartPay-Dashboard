# SmartPay Final Run Steps

## 1) Arduino Upload
1. Open `SmartPay-Dashboard/arduino-smartpay-example.ino` in Arduino IDE.
2. Select Board: Arduino Uno (or Nano ATmega328P if that is your board).
3. Select the correct COM/USB port.
4. Upload sketch.
5. Close Arduino Serial Monitor after upload.

## 2) Local Serial Check (Terminal)
1. In project root, list ports:
   - `npm run serial:list`
2. Optional raw serial reader (for debugging):
   - Linux: `PORT_PATH=/dev/ttyACM0 node index.js`
   - Windows: `node index.js COM5`

## 3) Local Realtime Dashboard Server
1. Start server:
   - Linux: `SERIAL_PORT=/dev/ttyACM0 npm start`
   - Windows CMD: `set SERIAL_PORT=COM5 && npm start`
2. Open browser: `http://localhost:3000`
3. Trigger sensor flow and confirm counter/events update.

## 4) Vercel Dashboard Note
- Vercel cannot directly read local USB serial.
- Keep a local USB bridge/server running on your machine to forward events to your deployed API/dashboard.

## 5) Quick Troubleshooting
- `No such file or directory` on serial port:
  - Use `npm run serial:list` and update port.
- `Access denied` or port busy:
  - Close Arduino Serial Monitor and any app using the same port.
- No events on dashboard:
  - Confirm baud rate is 9600 on both Arduino and Node.
  - Confirm serial lines are being printed in terminal.
