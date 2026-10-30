# Before real money and real people

Everything below needs a live account, so it could not be proved in the build environment. Do it once, in order.

## Must confirm with the providers
- [ ] **Celcom:** the real web address, field names and success response. Edit only `supabase/functions/_shared/sms.ts`. Send yourself one SMS.
- [ ] **Safaricom Daraja:** apply for live access to the platform Paybill now (it can take weeks). In the sandbox, test: STK prompt, success callback, cancelled prompt, timeout, a manual Paybill payment, and wrong amounts.
- [ ] Confirm the **C2B register-URL** endpoint version and the **STK status check** behaviour against Safaricom's current documentation (`functions/_shared/daraja.ts`).
- [ ] Ask Safaricom to enable **external validation** on the Paybill, so wrong manual amounts are refused up front. Without it, wrong amounts are still held safely, not credited.
- [ ] Optional but recommended: set `DARAJA_ALLOWED_IPS`-style filtering at your host or firewall to Safaricom's published callback addresses. The app already refuses callbacks it cannot confirm with Safaricom.
- [ ] Ask a lawyer whether holding landlords' rent on the platform Paybill needs a licence or partnership. Landlords who connect their own Paybill avoid this.
- [ ] Have a lawyer review the standard tenancy agreement text (`pages/landlord/AgreementPrint.tsx`), the terms of use and a privacy notice. Register under the Kenya Data Protection Act.

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
- Payouts to landlords on the platform Paybill are prepared automatically and paid by you (admin) by hand, then recorded. Automatic payouts need Safaricom's B2C approval.
- Own-Paybill mode supports Paybill numbers, not Till numbers.
- Tenants sign in with email and password. Google is for landlords.
- A payment found by the status check (not the callback) carries a clearly marked `STKQ-` reference instead of the M-Pesa receipt number.
- Photos are stripped and shrunk in the browser. A modified browser could upload an unstripped photo.
- English only.
