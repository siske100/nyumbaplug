# Rent payments

## Where a landlord can receive rent

Landlords select one route on the Payment setup page:

- **Platform Paybill:** rent reaches the platform Paybill and is paid out to the landlord's saved destination through the existing manual payout process.
- **Landlord's own Daraja Paybill:** the landlord connects their Daraja credentials. M-Pesa prompts and manual Paybill payments go to their own Paybill.
- **Bank Paybill:** tenants receive an M-Pesa prompt addressed to the configured bank Paybill and the landlord's bank account number. Bank details must be saved and a small test payment confirmed before the route can be selected. Use a business bank account; settlement is not instant.

## Payment processing

1. **Daraja rent:** the server calculates the balance and starts the M-Pesa prompt using the selected platform, landlord, or bank Paybill route.
2. **Payment confirmation:** Safaricom callbacks and status checks confirm the prompt before the ledger records it. Bank Paybill attempts retain the selected receiving Paybill for reconciliation.
3. **Silent M-Pesa prompts:** every 5 minutes the server asks Safaricom about prompts older than 3 minutes and settles them. After 24 hours they are written off.
4. **Landlord purchases** (subscription, SMS credit) always go to the platform Paybill by prompt, with the amount fixed by the database.

Subscriptions cost KES 1,000 per month for up to 20 houses, then KES 25 per additional house. The database calculates and validates the amount before a subscription payment can be recorded.

## What is tested, and what is not

Tested: Daraja callbacks, wrong-Paybill refusal, held payments, reconciliation, payouts, bank Paybill routing, and database access rules.

Not tested without live accounts (see `LAUNCH-CHECKLIST.md`): the actual conversations with Safaricom and Celcom, bank Paybill routing acceptance, and provider account setup.
