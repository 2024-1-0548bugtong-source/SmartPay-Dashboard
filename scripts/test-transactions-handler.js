const { Readable } = require('stream');
const path = require('path');
const handler = require(path.join(__dirname, '..', 'SmartPay-Dashboard', 'api', 'transactions.js'));

function makeReq(method, bodyObj) {
  const s = new Readable({ read() {} });
  if (bodyObj) s.push(JSON.stringify(bodyObj));
  s.push(null);
  s.method = method;
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
    handler(req, res).catch((e) => { console.error('handler error', e); resolve(); });
  });
  console.log('---', name, '---');
  console.log(JSON.parse(res._getBody().body));
}

(async () => {
  // Reset any in-memory store
  globalThis.__honestpayTransactions = [];

  // Test: FAILED with inserted 0
  await runTest('FAILED_inserted_0', { status: 'FAILED', reason: 'INSUFFICIENT', product: 'P1', price: 5, inserted: 0, rawLine: 'transaction:failed:P1:INSUFFICIENT' });

  // Test: Event-only PIR Entry
  await runTest('EVENT_entry', { event: 'Entry', rawLine: 'Entry: 1' });

  // Test: SUCCESS with inserted 5
  await runTest('SUCCESS_inserted_5', { status: 'SUCCESS', reason: 'VALID', product: 'P1', price: 5, inserted: 5, rawLine: 'transaction:success:P1:php5' });

  // Show store
  const store = globalThis.__honestpayTransactions || [];
  console.log('STORE:', store);

  // Now run the counter handler from SmartPay-Dashboard in same process
  const counter = require(path.join(__dirname, '..', 'SmartPay-Dashboard', 'api', 'counter.js'));
  const creq = { method: 'GET' };
  const cres = makeRes();
  await new Promise((resolve) => {
    cres._onDone(resolve);
    counter(creq, cres).catch((e) => { console.error('counter error', e); resolve(); });
  });
  console.log('COUNTER:', JSON.parse(cres._getBody().body));
})();
