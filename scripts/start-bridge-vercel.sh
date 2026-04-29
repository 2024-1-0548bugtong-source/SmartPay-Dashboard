#!/usr/bin/env bash
# Start the serial bridge and force it to post to the Vercel deployment.
# Usage: ./scripts/start-bridge-vercel.sh [serial-device]

SERIAL_DEVICE=${1:-auto}
export ALLOW_EVENT_POSTS=true
node bridge-json-vercel.js "$SERIAL_DEVICE" https://honest-pay-dashboard.vercel.app/
