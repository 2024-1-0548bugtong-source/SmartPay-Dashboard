1. error fix the custoner count 
[RAW] Distance: 5
[RAW] Entry: 3
[SKIP] Event posts disabled; not sending PIR event: entry
[RAW] Customer Entered
[SKIP] Non-entry PIR event: customer entered

2. 
fix complete transaction this is the transaction on dashboard.
 Completed Transactions
5 total
Timestamp	Product	Price (PHP)	Inserted (PHP)	Status	Reason
2026-04-29 13:26	P2	PHP 10	PHP 0	FAILED	INSUFFICIENT
2026-04-29 13:26	P2	PHP 10	PHP 0	FAILED	INSUFFICIENT
2026-04-29 13:25	P1	PHP 5	PHP 0	FAILED	INSUFFICIENT
2026-04-29 13:25	P2	PHP 10	PHP 10	SUCCESS	VALID
2026-04-29 13:25	P1	PHP 5	PHP 5	SUCCESS	VALID

it should be like this learn the logic focus on insufficient and invalid logic
 Completed Transactions
5 total
Timestamp	Product	Price (PHP)	Inserted (PHP)	Status	Reason
2026-04-29 13:26	P2	PHP 10	PHP 5	FAILED	INSUFFICIENT
2026-04-29 13:26	P2	PHP 10	PHP 5	FAILED	INSUFFICIENT
2026-04-29 13:25	P1	PHP 5	PHP 10	FAILED	INVALID
2026-04-29 13:25	P2	PHP 10	PHP 10	SUCCESS	VALID
2026-04-29 13:25	P1	PHP 5	PHP 5	SUCCESS	VALID

3. what is this in dashboard is it important 
Live Counter API
live
0
current count
Source: /api/counter

4.this was showen in cmd [RAW] Customer Entered
[SKIP] Non-entry PIR event: customer entered
[SENT] event:entry
if customer enter the entry cound in dashboard increment to 1

### 
Make npm run bridge:vercel work cross-platform (optional):

Install cross-env:
Edit package.json script bridge:vercel to:
