const path = require("path");

const args = process.argv.slice(2);
const serialPortArg = args[0];
const vercelBaseUrlArg = args[1];

if (!process.env.SERIAL_PORT && serialPortArg) {
  process.env.SERIAL_PORT = serialPortArg;
}

if (!process.env.VERCEL_BASE_URL && vercelBaseUrlArg) {
  process.env.VERCEL_BASE_URL = vercelBaseUrlArg;
}

if (!process.env.VERCEL_BASE_URL) {
  process.env.VERCEL_BASE_URL = "https://honest-pay-dashboard.vercel.app";
}

if (!process.env.ALLOW_EVENT_POSTS) {
  process.env.ALLOW_EVENT_POSTS = "true";
}

const bridge = require(path.join(__dirname, "..", "bridge-json-vercel.js"));

if (typeof bridge.start !== "function") {
  throw new Error("bridge-json-vercel.js does not export start()");
}

console.log("[honest-gateway] Delegating to bridge-json-vercel.js");
console.log(`[honest-gateway] Target: ${process.env.VERCEL_BASE_URL}`);

bridge.start().catch((err) => {
  console.error("[honest-gateway] Bridge failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
