# Before real money and real people

Everything below needs a live account, so it could not be proved in the build environment. Do it once, in order.

## Must confirm with the providers
- [ ] **Celcom:** the real web address, field names and success response. Edit only `supabase/functions/_shared/sms.ts`. Send yourself one SMS.
- [ ] **Safaricom Daraja:** apply for live access to each landlord-owned Paybill integration. In the sandbox, test STK prompt, success callback, cancelled prompt, timeout, landlord-scoped C2B validation, and wrong amounts. The platform Paybill is only for HousePlug Kenya purchases.
- [ ] **Bank / aggregator settlement:** do not enable until the provider confirms in writing that the integration can collect for multiple independent landlords and settle each tenant payment directly to the correct landlord bank account.
- [ ] Confirm the **C2B register-URL** endpoint version and the **STK status check** behaviour against Safaricom's current documentation (`functions/_shared/daraja.ts`).
- [ ] Ask Safaricom to enable **external validation** on the Paybill, so wrong manual amounts are refused up front. Without it, wrong amounts are still held safely, not credited.
- [ ] Optional but recommended: set `DARAJA_ALLOWED_IPS`-style filtering at your host or firewall to Safaricom's published callback addresses. The app already refuses callbacks it cannot confirm with Safaricom.
- [ ] Landlords upload their own tenancy agreements for tenants. Have a lawyer review the agreement landlords use, the terms of use and a privacy notice. Register under the Kenya Data Protection Act.

## Must verify on a real Supabase stack
- [ ] Run `npm run test:db` against the real stack (`supabase start`) or a staging project.
- [ ] Sign-up email code, Google sign-in, authenticator setup for the admin, private document storage, signed links.
- [ ] Confirm uploaded ID files cannot be opened by anyone but the owner and an admin.
- [ ] Turn on **backups** and do one test restore. Turn on error monitoring.

## Security basics
- [ ] Production `APP_ORIGIN` set to your real address. `DARAJA_ENV=production`. `SMS_PROVIDER=celcom`.
- [ ] Your own SMTP provider for emails.
- [ ] Back up `CODE_PEPPER` and `CREDENTIALS_KEY` somewhere safe.
- [ ] A second admin account with an authenticator, so you are not the only one who can approve landlords.
- [ ] Rotate every secret that was ever pasted into a chat or document.

## Known limits (by design, for now)
- Historical platform rent payouts remain visible for audit; new rent cannot enter the platform collection or payout flow.
- Current direct-rent support is one landlord-owned Daraja Paybill per landlord; Till and multiple simultaneous methods are not yet supported.
- Tenants sign in with email and password. Google is for landlords.
- A payment found by the status check (not the callback) carries a clearly marked `STKQ-` reference instead of the M-Pesa receipt number.
- Photos are stripped and shrunk in the browser. A modified browser could upload an unstripped photo.
- English only.


## Direct-to-landlord rent settlement cutover (2026-11-02)

- [ ] Apply migration `0030_direct_landlord_rent_only.sql` before deploying the matching Edge Functions and web app.
- [ ] Verify a landlord-owned Daraja Paybill can connect and is set to `own` automatically after credential verification.
- [ ] Verify a tenant prompt settles to that landlord's Paybill and the landlord-specific callback confirms it.
- [ ] Verify no tenant rent attempt can use the platform token/Paybill, including C2B validation and confirmation.
- [ ] Verify disconnected, failed, missing, or undecryptable landlord credentials fail closed.
- [ ] Verify old pending platform/bank rent attempts are failed and cannot be reconciled or credited.
- [ ] Verify subscriptions and SMS-credit purchases still use the platform Paybill.
- [ ] Do not enable bank, KCB Buni, Equity Jenga, PesaLink, Till, or any additional method until direct-to-landlord settlement is confirmed with the provider and live-tested.
- [ ] Current limitation: one landlord-owned Daraja Paybill is supported; multiple simultaneous payment methods are not implemented in this release.
