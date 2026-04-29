I am debugging an Arduino → CMD bridge that forwards PIR events to a Vercel API.

PROBLEM:
Customer entry count does not increment even though PIR events appear in logs.

EVIDENCE:
CMD logs show:
- Event "Entry" is valid and should increment the counter
- Variants like "entry" and "Customer Entered" are emitted
- Deduplication fires BEFORE increment:
  [SKIP] Duplicate PIR event within dedupe window: entry
- Non-canonical names are ignored:
  [SKIP] Non-entry PIR event: customer entered

ROOT CAUSE:
- Multiple PIR event names represent the same physical event
- Deduplication happens based on raw event string
- Valid Entry events are skipped before they reach the backend

REQUIRED FIX:

1) Normalize PIR event names EARLY:
   - Convert to lowercase
   - Map ALL variants to a single canonical event: "entry"

   Examples:
   "Entry" → "entry"
   "Customer Entered" → "entry"
   "customer entered" → "entry"

2) Apply deduplication ONLY AFTER normalization

3) Deduplicate by time (timestamp window), NOT raw string comparison

4) Ensure exactly ONE API call is sent per physical entry:
   - POST { event: "Entry", rawLine, timestamp }

5) Do NOT change backend or dashboard code

GOAL:
Every physical PIR trigger must:
- Result in exactly one Entry increment
- Not be skipped due to string variant or premature dedupe
``