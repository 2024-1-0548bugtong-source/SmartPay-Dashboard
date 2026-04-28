# SmartPay Windows Reconnect

Use this when you want to reconnect the Arduino to the deployed Vercel dashboard.

## What this does

- Reads Arduino JSON events from `COM5` at `9600` baud.
- Sends SmartPay entry, product, coin, and payment events to your deployed Vercel API.
- Opens the deployed dashboard in your browser.

## One-command reconnect

Run the batch file:

```bat
reconnect-smartpay.bat
```

## Manual run

If you prefer typing the command yourself:

```bat
cd /d D:\Users\user\Downloads\SmartPay-Dashboard npm run bridge:vercel -- COM5 https://smartpay-dashboard-two.vercel.app
```

## Change the COM port

Edit [reconnect-smartpay.bat](reconnect-smartpay.bat) and change:

```bat
set "COM_PORT=COM5"
```

to your actual port, such as `COM7`.

## Expected result

- A terminal window stays open running the bridge.
- Your browser opens the deployed dashboard.
- When Arduino sends SmartPay serial lines like `Entry: 1`, `Product Removed. Pay Product One (PHP5).`, `Coin Detected...`, or `Payment OK`, they appear in the dashboard transaction feed.

## Troubleshooting

- If the bridge says the port is busy, close Arduino Serial Monitor first.
- If the dashboard does not update, confirm the Vercel URL is correct.
- If no events arrive, confirm Arduino is sending valid JSON and the baud rate is `9600`.

cd /d D:\Users\user\Downloads\SmartPay-Dashboard
npm run bridge:vercel -- COM5 https://smartpay-dashboard-two.vercel.app
