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

  const paymentInvalid = parse('PAYMENT INVALID');
  assert.equal(paymentInvalid.event, 'Invalid Coin');
  assert.equal(paymentInvalid.paymentStatus, null, 'generic failure markers must stay neutral');

  const paymentIncomplete = parse('Payment Incomplete');
  assert.equal(paymentIncomplete.event, 'Invalid Coin');
  assert.equal(paymentIncomplete.paymentStatus, null, 'payment incomplete must not be pre-labeled insufficient');

  const addMoreCoins = parse('Add More Coins');
  assert.equal(addMoreCoins.event, 'Invalid Coin');
  assert.equal(addMoreCoins.paymentStatus, null, 'add more coins must not be pre-labeled insufficient');

  const placeholderInvalidCoin = parse('Coin Detected: ?g -> INVALID COIN');
  assert.equal(placeholderInvalidCoin.event, 'Invalid Coin');
  assert.equal(placeholderInvalidCoin.weight, null, 'placeholder invalid coin lines must still parse');

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

  resetBridgeStateForTests();
  consumeEventTransaction(parse('Product Removed. Pay Product One (PHP5).'), baseMs);
  consumeEventTransaction(parse('Coin Detected: ?g -> INVALID COIN'), baseMs + 1_000);
  assert.equal(
    consumeEventTransaction(parse('Payment Incomplete'), baseMs + 2_000),
    null,
    'payment incomplete should keep a failed draft open until trailing telemetry or session close',
  );
  consumeEventTransaction(
    parse('Product Weight: 346.93 g | Coin Weight: 40.14 g | Product Type: 1 | Coin Value: 10 | Payment: NOT OK'),
    baseMs + 3_000,
  );

  const invalidOverpay = consumeEventTransaction(parse('Customer Left'), baseMs + 4_000);
  assert.ok(invalidOverpay, 'customer left should finalize a failed overpay attempt once telemetry has landed');
  assert.equal(invalidOverpay.status, 'FAILED');
  assert.equal(invalidOverpay.reason, 'INVALID');
  assert.equal(invalidOverpay.inserted, 10);

  resetBridgeStateForTests();
  consumeEventTransaction(parse('Product Removed. Pay Product Two (PHP10).'), baseMs);
  consumeEventTransaction(parse('Coin Detected: ?g -> INVALID COIN'), baseMs + 1_000);
  assert.equal(
    consumeEventTransaction(parse('Payment Incomplete'), baseMs + 2_000),
    null,
    'payment incomplete should also wait for trailing telemetry on underpay attempts',
  );
  consumeEventTransaction(
    parse('Product Weight: 702.44 g | Coin Weight: 35.11 g | Product Type: 2 | Coin Value: 5 | Payment: NOT OK'),
    baseMs + 3_000,
  );

  const invalidUnderpay = consumeEventTransaction(parse('Customer Left'), baseMs + 4_000);
  assert.ok(invalidUnderpay, 'customer left should finalize a failed underpay attempt once telemetry has landed');
  assert.equal(invalidUnderpay.status, 'FAILED');
  assert.equal(invalidUnderpay.reason, 'INSUFFICIENT');
  assert.equal(invalidUnderpay.inserted, 5);

  console.log('Payment grace tests PASSED');
}

run();
