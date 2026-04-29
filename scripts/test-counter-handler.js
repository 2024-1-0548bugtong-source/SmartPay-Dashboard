const path = require('path');
const counter = require(path.join(__dirname, '..', 'SmartPay-Dashboard', 'api', 'counter.js'));

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
  const req = makeReq();
  const res = makeRes();
  await new Promise((resolve) => {
    res._onDone(resolve);
    counter(req, res).catch((e) => { console.error(e); resolve(); });
  });
  console.log('COUNTER RESPONSE:', JSON.parse(res._getBody().body));
})();
