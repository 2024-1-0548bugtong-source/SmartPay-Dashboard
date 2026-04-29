// @ts-nocheck

const assert = require('node:assert/strict');
const {
  PAYMENT_GRACE_MS,
  parseSmartPayLine,
  consumeEventTransaction,
  resetBridgeStateForTests,
} = require('../bridge-json-vercel.js');

function parse(rawLine) {
  const parsed = parseSmartPayLine(rawLine);
  assert.ok(parsed, `Expected line to parse: ${rawLine}`);
  assert.equal(parsed.kind, 'event');
  return parsed;
}

function run() {
  const baseMs = Date.UTC(2026, 3, 29, 9, 15, 0);

  resetBridgeStateForTests();
  assert.equal(
    consumeEventTransaction(parse('Product Removed. Pay Product One (PHP5).'), baseMs),
    null,
    'starting a payment should not immediately complete a transaction',
  );

  assert.equal(
    consumeEventTransaction(parse('HonestPay Ready'), baseMs + 5_000),
    null,
    'ready events inside the grace window should not mark unpaid yet',
  );

  const timedOut = consumeEventTransaction(parse('HonestPay Ready'), baseMs + PAYMENT_GRACE_MS + 1_000);
  assert.ok(timedOut, 'ready after the grace window should finalize an unpaid transaction');
  assert.equal(timedOut.status, 'FAILED');
  assert.equal(timedOut.reason, 'INSUFFICIENT');
  assert.equal(timedOut.inserted, 0);

  resetBridgeStateForTests();
  consumeEventTransaction(parse('Product Removed. Pay Product One (PHP5).'), baseMs);
  consumeEventTransaction(parse('Coin Detected: 7.30g -> PHP5 ACCEPTED'), baseMs + 10_000);

  assert.equal(
    consumeEventTransaction(parse('Customer Left'), baseMs + 20_000),
    null,
    'customer-left inside the grace window after coin activity should still wait',
  );

  const lateCustomerLeft = consumeEventTransaction(parse('Customer Left'), baseMs + 41_000);
  assert.ok(lateCustomerLeft, 'customer-left after the grace window should finalize the transaction');
  assert.equal(lateCustomerLeft.status, 'FAILED');
  assert.equal(lateCustomerLeft.inserted, 5);

  console.log('Payment grace tests PASSED');
}

run();
