# Rent payments

## Non-negotiable settlement rule

HousePlug Kenya does not collect, hold, pool, or pay out rent. A tenant rent payment is initiated only when the landlord has a connected and verified merchant account whose own Daraja credentials are used for that payment. The platform Paybill is reserved for HousePlug Kenya subscriptions and SMS credit purchases; it is never a rent fallback. If the landlord's direct connection is missing, disconnected, or fails, the tenant cannot pay through the app and must contact the landlord.

## Rent payment methods currently enabled

- **Landlord's own Daraja Paybill:** the landlord connects their own consumer key, consumer secret, passkey, and Paybill shortcode. The server tests the credentials, registers landlord-scoped C2B callback URLs, encrypts the credentials, and stores them server-side. STK prompts and manual C2B rent payments are scoped to that landlord's own Paybill and tenants.
- **Manual bank transfer:** the landlord saves a bank, account number, and account-holder name, then selects this as the one active rent method. Tenants see those details and submit the transfer message together with their full outstanding balance. A message is only an unverified claim. The landlord must independently check their bank account and confirm receipt; only that server-side confirmation creates an append-only rent ledger entry. Rejected or pending claims do not affect the balance. A claim cannot be confirmed if the tenant's balance has changed since submission.

The landlord selects exactly one active method. Tenants see and can use only that selected method; manual transfer does not trigger an STK prompt. Bank Paybill routing and platform-Paybill rent collection are disabled for new rent payments. The previous bank Paybill flow used HousePlug Kenya's Daraja credentials with a bank shortcode; that does not establish that a provider has authorised direct settlement to every landlord. Existing bank test records and old ledger/payout history are retained for audit.

## Payment processing

### Daraja

1. The database calculates the tenant's outstanding balance.
2. The server loads the landlord's connected Daraja credentials. If they are missing, not connected, or cannot be decrypted, the attempt fails closed; it never substitutes platform credentials.
3. Safaricom sends the STK callback to the landlord-specific callback token. The server performs an STK query before crediting the ledger. Duplicate receipts are idempotent, mismatched amounts are held, and ledger entries remain append-only.
4. Manual Paybill validation and confirmation are accepted only on the landlord-specific callback token. The platform callback token is rejected for tenant rent C2B.

### Manual bank transfer

1. The database checks that the tenant submits exactly the current full outstanding balance and permits only one pending claim per tenancy.
2. The tenant's pasted transaction message is stored as claim information, not treated as evidence or posted to the ledger.
3. Only the owning landlord can review the claim. Confirming receipt checks that the balance is still unchanged and atomically creates one `manual_transfer` ledger entry. Rejection never credits rent.

Old pending platform/bank rent attempts are failed during migration so they cannot settle after cutover. HousePlug Kenya subscription and SMS-credit purchases continue to use the platform Paybill through the separate platform purchase flow.

## What is not yet enabled

The app does **not** implement automated bank settlement, KCB Buni, Equity Jenga, or PesaLink. These integrations must be labeled **Coming soon**, not offered as active payment options, until each provider confirms a supported multi-merchant/direct-settlement arrangement and the relevant adapter, verification, callback, reconciliation, and security tests are implemented. Manual bank transfer is a separate landlord-reviewed route and does not claim to integrate with or verify any bank provider.
