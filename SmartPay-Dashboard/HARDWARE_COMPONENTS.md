## SmartPay Hardware Bill of Materials

1. **20x4 Character LCD Display Module** with I2C interface adapter
   - Address: 0x27 (typical, adjust if needed)
   - Pins: SDA (A4), SCL (A5) on Arduino Nano

2. **Arduino Nano ATmega328P** CH340G/CH340
   - Main controller
   - Serial: 9600 baud

3. **Load Cell Amplifier HX711** (x2)
   - **Product scale**
     - DT pin: 4
     - SCK pin: 5
   - **Coin/payment scale**
     - DT pin: 6
     - SCK pin: 7

4. **PIR Motion Sensor SR501 HC-SR501**
   - Detects customer presence
   - Pin: 6

5. **5V Buzzer** (active or passive)
   - Audio feedback for events
   - Pin: 7

6. **Single LED**
   - Waiting-for-payment indicator
   - Arduino pin: D13
   - Recommended wiring: D13 -> 220Ω to 1kΩ resistor -> LED anode, LED cathode -> GND

7. **HC-05 Bluetooth Transceiver** (6-pin)
   - For remote monitoring via phone/tablet
   - Serial connection on Software Serial (pins 10, 11)
   - **See [HC05_SETUP_AND_DEPLOYMENT.md](HC05_SETUP_AND_DEPLOYMENT.md) for detailed wiring and setup instructions**
   - Default PIN: 1234
   - Baud rate: 9600

8. **Jumper Wires**
   - Breadboard/solderless connections

9. **Capacitor**
   - For power smoothing if needed
   10. Transistors
   11. 
   
## Setup Instructions

1. Upload [smartpay-arduino.ino](smartpay-arduino.ino) to the Arduino Nano
2. Calibrate both load cells (see instructions in the sketch and protocol doc)
3. Verify the D13 LED turns on while the machine is waiting for coins
4. Adjust product weight thresholds for your items
5. **[For HC-05 Connection] Follow [HC05_SETUP_AND_DEPLOYMENT.md](HC05_SETUP_AND_DEPLOYMENT.md) for pairing and testing**
6. **[For Store Owner] Deploy dashboard using instructions in [HC05_SETUP_AND_DEPLOYMENT.md](HC05_SETUP_AND_DEPLOYMENT.md) (Option A, B, or C)**
7. Store owner connects at dashboard URL and clicks "Connect Arduino"
8. Select the COM port (USB) or Bluetooth device (HC-05) in the Web Serial picker
9. Run demo or trigger manually by placing products on the scale
10. **First-time setup? See [STORE_OWNER_QUICK_START.md](STORE_OWNER_QUICK_START.md) for daily startup procedures**
