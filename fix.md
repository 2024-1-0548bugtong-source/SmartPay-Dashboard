1. the old live transaction are still there. i thought you fixed it

Live Transaction Log
61 entries
Timestamp	Event	Product	Payment Status	Coin Value	Weight
2026-04-28 09:09	Customer Left	—	—	—	—
2026-04-28 09:09	Inserted Balance	—	—	—	—
2026-04-28 09:09	Product Removed	Product Two (PHP10)	Pending	—	—
2026-04-28 09:08	Entry	—	—	—	—
2026-04-28 09:08	Customer Left	—	—	—	—
2026-04-28 09:08	Inserted Balance	—	—	—	—
2026-04-28 09:08	Product Removed	Product One (PHP5)	Pending

2. still no changes in dashboard through vercel it should be HonestPay Dashboard
3. still the payment success is showing pending in the dashboard.
4. can you remove the pending or if pending = payment OK = verified. then forward the success rate. 
5. if invalid and insufficient coin treat it as fail in success rate.
6. then Restart the app process that serves the dashboard (dev server or node server).