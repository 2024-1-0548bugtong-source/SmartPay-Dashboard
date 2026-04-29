// @ts-nocheck

const assert = require('node:assert/strict');
const { Readable } = require('stream');
const path = require('path');
const transactionsHandler = require(path.join(__dirname, '..', 'api', 'transactions.js'));
const counterHandler = require(path.join(__dirname, '..', 'api', 'counter.js'));

function makeReq(method, bodyObj, headers = {}) {
  const s = new Readable({ read() {} });
  if (bodyObj) s.push(JSON.stringify(bodyObj));
  s.push(null);
  s.method = method;
  s.headers = headers;
  return s;
}

function makeRes() {
  const headers = {};
  let statusCode = 200;
  let body = '';
  return {
    setHeader(k, v) { headers[k] = v; },
    end(data) { body += data; this._done && this._done(); },
    get statusCode() { return statusCode; },
    set statusCode(v) { statusCode = v; },
    _onDone(cb) { this._done = cb; },
    _getBody() { return { statusCode, headers, body }; },
  };
}

async function runTest(name, reqBody) {
  const req = makeReq('POST', reqBody);
  const res = makeRes();
  await new Promise((resolve) => {
    res._onDone(resolve);
    transactionsHandler(req, res).catch((e) => { console.error('handler error', e); resolve(); });
  });
  console.log('---', name, '---');
  return JSON.parse(res._getBody().body);
}

(async () => {
  // Reset any in-memory store
  globalThis.__honestpayTransactions = [];

  // Test: FAILED with inserted 0
  const failedBody = await runTest('FAILED_inserted_0', { status: 'FAILED', reason: 'INSUFFICIENT', product: 'P1', price: 5, inserted: 0, rawLine: 'transaction:failed:P1:INSUFFICIENT' });
  console.log(failedBody);
  assert.equal(failedBody.row.inserted, 0);

  // Test: Event-only PIR Entry
  const eventBody = await runTest('EVENT_entry', { event: 'Entry', rawLine: 'Entry: 1' });
  console.log(eventBody);
  assert.equal(eventBody.row.event, 'Entry');

  // Test: SUCCESS with inserted 5
  const successBody = await runTest('SUCCESS_inserted_5', { status: 'SUCCESS', reason: 'VALID', product: 'P1', price: 5, inserted: 5, rawLine: 'transaction:success:P1:php5' });
  console.log(successBody);
  assert.equal(successBody.row.inserted, 5);

  // Show store
  const store = globalThis.__honestpayTransactions || [];
  console.log('STORE:', store);
  assert.equal(store.length, 3);

  const originalFetch = global.fetch;
  const originalTransactionsUrl = process.env.TRANSACTIONS_API_URL;
  process.env.TRANSACTIONS_API_URL = 'http://test.local/api/transactions';
  global.fetch = async () => ({ ok: true, json: async () => store });

  // Run the deployed root counter handler against the transactions feed.
  const creq = { method: 'GET', headers: { host: 'test.local' } };
  const cres = makeRes();
  await new Promise((resolve) => {
    cres._onDone(resolve);
    counterHandler(creq, cres).catch((e) => { console.error('counter error', e); resolve(); });
  });
  const counterBody = JSON.parse(cres._getBody().body);
  console.log('COUNTER:', counterBody);
  assert.equal(counterBody.count, 1);

  if (originalTransactionsUrl === undefined) delete process.env.TRANSACTIONS_API_URL;
  else process.env.TRANSACTIONS_API_URL = originalTransactionsUrl;
  global.fetch = originalFetch;

  console.log('All transaction handler checks PASSED');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
