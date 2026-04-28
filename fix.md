1. these are the updated but the payment status on product two is null i remember seeing the hardware said payment success so it should be in dashboard says Payment OK - verified 

Live Transaction Log
2026-04-28 09:48	Customer Left	—	—	—	—
2026-04-28 09:48	Add More Coins	—	Insufficient	—	—
2026-04-28 09:48	Product Removed	Product Two (PHP10)	—	—	—

2. also in the insuffient in the logs did not add total in success rate
3.the revenue in the dashboard is fixed
4. when its insufficient the succes rate is fail the toatl cuccess rate decrease when the payment status is payment ok - verified the succes rate total increase 
5. if invalid and insufficient coin treat it as fail in success rate.
6.fix the clear logs in dashboard. when user click it all logs including pir entries are back to zero to store a new data again.
7. still there are some wrong logic sending in the dashboard can you do a throughly debug and fix the proper logic as a senior developer. make sure to code a clean code
8. final follow and focus on this logic

#### hardware                                          
honest pay ready
no product - P1: 200g =P5                                    
insert coin - COIN : 5PESOS
waiting payment - PAYMENT SUCCESS
----
no product - P2: 400g =P10
insert coin - COIN : 10PESOS
waiting payment - PAYMENT SUCCESS
----
no product - P1: 200g =P5
insert coin - COIN : 10PESOS
waiting payment - PAYMENT INVALID
----
no product - P2: 400g =P10
insert coin - COIN : 5PESOS
waiting payment - PAYMENT INVALID
----
no product - P1: 200g =P5
insert coin - (user did not insert coin)
waiting payment - PAYMENT INVALID
----
no product - P2: 400g =P10
insert coin - (user did not insert coin)
waiting payment - PAYMENT INVALID

## DASHBOARD
Event: Product Removed Product: Product One (PHP5)
Event: Inserted Balance
Event Payment OK   payment status: Verified coin value: PHP5 weight: 7.3g
----
Event: Product Removed Product: Product two (PHP10)
Event: Inserted Balance
Event Payment OK   payment status: Verified coin value: PHP10 weight: g
---
Event: Product Removed Product: Product One (PHP5)
Event: Inserted Balance
Event: invalid coin  payment status: Insufficient value: PHP5 weight: 7.3g
---
Event: Product Removed Product: Product two (PHP10)
Event: Inserted Balance
Event: invalid coin  payment status: Insufficient value: PHP10 weight: g
----
Event: Product Removed Product: Product one (PHP5)
Event: invalid coin  payment status: Insufficient value: PHP5 weight: g
----
Event: Product Removed Product: Product two (PHP10)
Event: invalid coin  payment status: Insufficient value: PHP10 weight: g