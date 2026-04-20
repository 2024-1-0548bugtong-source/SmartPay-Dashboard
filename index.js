const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");

const args = process.argv.slice(2);
const showListOnly = args.includes("--list");
const argPort = args.find((a) => !a.startsWith("--"));
const portPath = argPort || process.env.PORT_PATH || "COM5";
const baudRate = Number(process.env.BAUD_RATE || 9600);

async function listPorts() {
  const ports = await SerialPort.list();
  if (!ports.length) {
    console.log("No serial ports found.");
    return;
  }

  console.log("Available serial ports:");
  for (const p of ports) {
    console.log(`- ${p.path} ${p.manufacturer ? `(${p.manufacturer})` : ""}`.trim());
  }
}

async function readPort() {
  const port = new SerialPort({
    path: portPath,
    baudRate,
  });

  const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

  console.log(`Listening on ${portPath} @ ${baudRate} baud...`);
  console.log("Press Ctrl+C to stop.");

  parser.on("data", (line) => {
    const message = String(line).trim();
    if (!message) return;
    console.log(`[HC-05] ${message}`);
  });

  port.on("error", (err) => {
    console.error(`Serial error: ${err.message}`);
  });
}

async function main() {
  if (showListOnly) {
    await listPorts();
    return;
  }

  await readPort();
}

main().catch((err) => {
  console.error(`Failed: ${err.message}`);
  process.exit(1);
});
