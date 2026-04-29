// @ts-nocheck

const assert = require('node:assert/strict');
const path = require('path');
const counter = require(path.join(__dirname, '..', 'api', 'counter.js'));

function makeReq() { return { method: 'GET' }; }
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

(async () => {
  const rows = [
    { timestamp: '2026-04-29T08:00:00.000Z', event: 'Entry', rawLine: 'Entry: 1' },
    { timestamp: '2026-04-29T08:00:01.000Z', event: 'Customer Entered', rawLine: 'Customer Entered' },
    { timestamp: '2026-04-29T08:00:06.500Z', event: 'Entry', rawLine: 'entry' },
    { timestamp: '2026-04-29T08:00:07.000Z', status: 'SUCCESS', rawLine: 'transaction:success:P1:php5' },
  ];

  const originalFetch = global.fetch;
  const originalTransactionsUrl = process.env.TRANSACTIONS_API_URL;
  process.env.TRANSACTIONS_API_URL = 'http://test.local/api/transactions';
  global.fetch = async () => ({ ok: true, json: async () => rows });

  const req = { ...makeReq(), headers: { host: 'test.local' } };
  const res = makeRes();
  await new Promise((resolve) => {
    res._onDone(resolve);
    counter(req, res).catch((e) => { console.error(e); resolve(); });
  });
  const body = JSON.parse(res._getBody().body);
  console.log('COUNTER RESPONSE:', body);
  assert.equal(body.count, 2);
  assert.equal(body.totalRows, rows.length);

  if (originalTransactionsUrl === undefined) delete process.env.TRANSACTIONS_API_URL;
  else process.env.TRANSACTIONS_API_URL = originalTransactionsUrl;
  global.fetch = originalFetch;

  console.log('Counter handler checks PASSED');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
