# Database and server functions

Project **hostel-new**, ref `gzhyorqbpvpoevaeiuvz`.

Migrations, in order: `0001_core`, `0002_money`, `0003_access`, `0004_signup`, `0005_jobs`, `0006_onboarding`, `0007_storage`,
`0008_admin`, `0009_features`, `0010_payment_plumbing`, `0011_caretakers_view`, `0012_landlord_email_verification`. Then `seed/seed.sql`, then `cron.sql`.

## Set up, in this order
1. **Link and apply the database**
   ```bash
   supabase login
   supabase link --project-ref gzhyorqbpvpoevaeiuvz
   supabase db push
   ```
   Then run `supabase/seed/seed.sql` in the SQL editor (47 counties and starter towns). Add more towns from the SQL editor or an admin tool as you need them.
2. **Auth** (Dashboard > Authentication)
   - Email provider: **Confirm email** on, minimum password length **10**.
   - Email template "Confirm signup": paste `supabase/templates/confirmation.html` (it shows the 6-digit code).
   - Google provider: client ID and secret from Google Cloud Console. In Google add `https://gzhyorqbpvpoevaeiuvz.supabase.co/auth/v1/callback` as an authorised redirect address.
   - URL Configuration: Site URL is your live address. Add `http://localhost:5173` while testing.
   - **Multi-factor:** make sure authenticator-app (TOTP) factors are enabled. Admin access needs one.
   - Built-in email is for testing only (a few emails an hour). Add your own SMTP before launch.
3. **Secrets for the server functions.** Never put these in the web app.
   ```bash
   supabase secrets set \
     CODE_PEPPER=$(openssl rand -hex 32) \
     CREDENTIALS_KEY=$(openssl rand -base64 32) \
     CRON_SECRET=$(openssl rand -hex 24) \
     PLATFORM_CALLBACK_TOKEN=$(openssl rand -hex 24) \
     APP_ORIGIN=http://localhost:5173 \
     SMS_PROVIDER=console \
     DARAJA_ENV=sandbox \
     PLATFORM_DARAJA_CONSUMER_KEY=... PLATFORM_DARAJA_CONSUMER_SECRET=... \
     PLATFORM_DARAJA_SHORTCODE=... PLATFORM_DARAJA_PASSKEY=...
   ```
   Keep a safe copy of `CODE_PEPPER` and `CREDENTIALS_KEY`: losing the credentials key makes saved landlord Paybill details unreadable, and changing the pepper invalidates open invite links.
   For real SMS: `SMS_PROVIDER=celcom` and `CELCOM_API_URL`, `CELCOM_API_KEY`, `CELCOM_PARTNER_ID`, `CELCOM_SHORTCODE`. **Check Celcom's API documentation first**: the request format in `functions/_shared/sms.ts` is my best understanding.
   Your Daraja app (developer.safaricom.co.ke) provides the platform consumer key, secret, shortcode and passkey. Start in the sandbox (`DARAJA_ENV=sandbox`), switch to `production` once Safaricom approves your Paybill.
4. **Deploy the functions**
   ```bash
   supabase functions deploy phone-code-send phone-code-verify email-verified-sync admin-send-reminder daraja-stk platform-pay \
     daraja-stk-callback daraja-c2b-validate daraja-c2b-confirm payments-connect sms-broadcast visit-code-send visit-request \
     invite-create invite-lookup invite-accept cron
   ```
5. **Schedule the jobs:** edit `supabase/cron.sql` (paste your CRON_SECRET) and run it in the SQL editor.
6. **Web app:** copy `apps/web/.env.example` to `apps/web/.env`, paste the **anon** key (Project Settings > API), then `npm run dev`.

## Make yourself the admin
Sign up as a landlord normally (so your email is confirmed), then in the SQL editor:
```sql
update public.profiles set role = 'admin', landlord_state = null where email = 'you@example.com';
delete from public.sms_wallets where landlord_id = (select id from public.profiles where email = 'you@example.com');
delete from public.payment_accounts where landlord_id = (select id from public.profiles where email = 'you@example.com');
```
Sign in at `/sign-in`. The first time, you set up an authenticator app. After that every admin sign-in asks for a code, and the database refuses admin actions without it.

## Test it end to end (sandbox, free)
1. Sign up as a landlord and confirm the email code. Landlords add a phone number for M-Pesa prompts but do not verify it with an SMS code.
2. Upload an ID and KRA PIN. In `/admin`, approve it. The landlord now sees "pay your first month".
3. Pay with the Daraja sandbox (the sandbox accepts a test phone number). Landlord becomes active.
4. Post a house with 3 photos. Open it on the public site. Request a viewing as a visitor (phone code), then schedule it in `/admin`.
5. Add a tenant, send the invite, open the link, create the tenant login, confirm the phone, pay rent with the prompt.
6. Watch the ledger, the payment text, the reminders (run the `cron` function by hand with task `reminders`) and the admin pages.

## Tests
`npm test` runs 197 tests: 20 shared rules, 133 database tests (a real Postgres engine with a stand-in for Supabase's own parts), 44 server-function tests (Deno). Before launch, run the database checks once on a real Supabase stack as well.

## Rules for every new migration
1. New table: enable row-level security and grant only the columns a browser needs.
2. New function: `revoke all ... from public, anon, authenticated`, then grant to exactly who needs it. A test fails if one becomes callable by accident.
3. Anything `security definer` must set `search_path` and check who is calling.
4. Money tables are append-only. Fix mistakes with a reversal, never an edit.
