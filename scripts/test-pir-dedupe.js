// @ts-nocheck

const DEDUPE_WINDOW_MS = Number(process.env.DEDUPE_WINDOW_MS || 2500);

let lastPirSentAt = 0;

function normalizeEvent(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function isPirEventName(eventName) {
  return eventName === 'entry' || eventName === 'customer entered' || eventName === 'customer_entered';
}

function shouldDropPirDuplicate(nowMs) {
  return nowMs - lastPirSentAt < DEDUPE_WINDOW_MS;
}

function parseSmartPayLineForPir(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^entry(?:\s*:\s*\d+)?$/i.test(s)) return 'Entry';
  if (/^customer(?:\s+|_)entered\b/i.test(s)) return 'Customer Entered';
  if (/\bentry\b/i.test(s)) return 'Entry';
  return null;
}

function processLine(rawLine, nowMs) {
  const ev = parseSmartPayLineForPir(rawLine);
  if (!ev) return false;

  let eventName = normalizeEvent(ev);
  if (isPirEventName(eventName)) {
    eventName = 'entry';
  }

  if (shouldDropPirDuplicate(nowMs)) {
    console.log(`[SKIP] Duplicate PIR event within dedupe window: ${eventName} (raw: ${rawLine})`);
    return false;
  }

  console.log(`[POST] event:Entry raw: ${rawLine} at +${nowMs}ms`);
  lastPirSentAt = nowMs;
  return true;
}

function runTest(name, events, expectedPosts) {
  console.log(`\n--- ${name} ---`);
  // Reset dedupe state for each test
  lastPirSentAt = 0;
  // Start at a realistic epoch so initial event isn't treated as duplicate
  let now = Date.now();
  let posts = 0;
  for (const ev of events) {
    now += ev.offsetMs;
    if (processLine(ev.line, now)) posts++;
  }
  console.log(`Expected posts: ${expectedPosts}, actual posts: ${posts}`);
  return posts === expectedPosts;
}

const tests = [
  {
    name: 'Entry then Customer Entered (50ms) -> one post',
    events: [
      { line: 'Entry: 1', offsetMs: 0 },
      { line: 'Customer Entered', offsetMs: 50 },
    ],
    expectedPosts: 1,
  },
  {
    name: 'Entry then Entry (3s) -> two posts',
    events: [
      { line: 'Entry: 1', offsetMs: 0 },
      { line: 'Entry: 2', offsetMs: 3000 },
    ],
    expectedPosts: 2,
  },
  {
    name: 'Customer Entered only -> one post',
    events: [
      { line: 'Customer Entered', offsetMs: 0 },
    ],
    expectedPosts: 1,
  },
  {
    name: 'Duplicate Entry within window -> one post',
    events: [
      { line: 'Entry: 10', offsetMs: 0 },
      { line: 'Entry: 10', offsetMs: 100 },
      { line: 'Customer Entered', offsetMs: 200 },
    ],
    expectedPosts: 1,
  },
  {
    name: 'Entry with different raw forms within window -> one post',
    events: [
      { line: 'entry', offsetMs: 0 },
      { line: 'Entry: 5', offsetMs: 100 },
      { line: 'customer_entered', offsetMs: 200 },
    ],
    expectedPosts: 1,
  },
  {
    name: 'Separated entries beyond window -> two posts',
    events: [
      { line: 'Entry: 1', offsetMs: 0 },
      { line: 'Customer Entered', offsetMs: DEDUPE_WINDOW_MS + 10 },
    ],
    expectedPosts: 2,
  },
];

let allOk = true;
for (const t of tests) {
  const ok = runTest(t.name, t.events, t.expectedPosts);
  if (!ok) allOk = false;
}

console.log(`\nAll tests ${allOk ? 'PASSED' : 'FAILED'}`);
process.exit(allOk ? 0 : 2);
