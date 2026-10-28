# Payments (M-Pesa Daraja only)

## Two ways rent can land (a landlord chooses, on the M-Pesa setup page)
- **Platform Paybill (default):** rent lands in the platform's Paybill. `create_due_payouts` prepares a payout of everything owed (each ledger entry once), and the admin pays it by M-Pesa and records the reference.
- **Landlord's own Paybill:** the landlord pastes their Daraja keys. They are tested with Safaricom, the payment addresses are registered, and the keys are stored encrypted. Rent lands straight with them. Nothing to pay out. Paybill numbers only.

## Flows
1. **Tenant taps Pay:** the server reads the full balance, the database creates the attempt (and refuses bad requests), a prompt goes to the tenant's verified phone, and the attempt is bound to Safaricom's request id.
2. **Safaricom answers:** the callback is accepted only with the secret address, a matching attempt, and Safaricom's own confirmation. Then the ledger entry is created, once, and the tenant gets a text from the landlord's SMS wallet (it fails quietly at zero balance).
3. **Manual Paybill:** validation accepts only the exact full balance for a known account of the right landlord. Confirmation records it. Anything unmatched is held: wrong amounts go to the landlord (Payments page), unknown accounts go to the platform.
4. **Silent prompts:** every 5 minutes the server asks Safaricom about prompts older than 3 minutes and settles them. After 24 hours they are written off.
5. **Landlord purchases** (subscription, SMS credit) always go to the platform Paybill by prompt, with the amount fixed by the database.

Subscriptions cost KES 1,000 per month for up to 20 houses, then KES 25 per additional house. The database calculates and validates the amount before a subscription payment can be recorded.

## What is tested, and what is not
Tested: the request builders, callback and payment readers, the secret-address and Safaricom-confirmation checks, idempotency, amounts, wrong-Paybill refusal, encryption, held payments, reconciliation, payouts, and every database rule above.
Not tested (needs live accounts, see `LAUNCH-CHECKLIST.md`): the actual conversation with Safaricom and Celcom.
