# Rent payments

## Where a landlord can receive rent

Landlords select one route on the Payment setup page:

- **Platform Paybill:** rent reaches the platform Paybill and is paid out to the landlord's saved destination through the existing manual payout process.
- **Landlord's own Daraja Paybill:** the landlord connects their Daraja credentials. M-Pesa prompts and manual Paybill payments go to their own Paybill.
- **Bank Paybill:** tenants receive an M-Pesa prompt addressed to the configured bank Paybill and the landlord's bank account number. After saving bank details, the landlord sends a KES 10 test payment to that bank Paybill from the phone number entered during registration. Safaricom's callback and STK query must confirm it, and the landlord must then confirm the funds arrived in the bank account before the route can be selected. A receipt typed by the landlord is never accepted as proof. Use a business bank account; settlement is not instant.

Landlords can remove their saved bank account details and enter replacement details when their bank account changes. Removing the saved details switches rent back to Platform Paybill, clears verification, and retains the test-payment history.

## Payment processing

1. **Daraja rent:** the server calculates the balance and starts the M-Pesa prompt using the selected platform, landlord, or bank Paybill route.
2. **Payment confirmation:** Safaricom callbacks and status checks confirm the prompt before the ledger records it. Bank Paybill attempts retain the selected receiving Paybill for reconciliation.
3. **Bank test payments:** `daraja-stk` sends the test prompt using the platform Daraja credentials and the bank Paybill as the destination. Callback/query results are stored in `bank_test_payments`; server-side confirmation requires both Safaricom success and the landlord's separate receipt-of-funds confirmation.
4. **Silent M-Pesa prompts:** every 5 minutes the server asks Safaricom about prompts older than 3 minutes and settles them. After 24 hours they are written off.
5. **Landlord purchases** (subscription, SMS credit) always go to the platform Paybill by prompt, with the amount fixed by the database.

Subscriptions cost KES 1,000 per month for up to 20 houses, then KES 25 per additional house. The database calculates and validates the amount before a subscription payment can be recorded.

## What is tested, and what is not

Tested: Daraja callbacks, wrong-Paybill refusal, held payments, reconciliation, payouts, bank Paybill routing, and database access rules.

Not tested without live accounts (see `LAUNCH-CHECKLIST.md`): the actual conversations with Safaricom and Celcom, bank Paybill routing acceptance, and provider account setup.
