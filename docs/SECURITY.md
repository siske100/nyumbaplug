# Security

**The browser is never the security boundary.** Screens hide things for convenience. The database and the server functions enforce.

## Enforced and tested (197 tests)
**Who sees what**
- Landlords cannot read or change each other's houses, tenants, payments, SMS, complaints or documents.
- The admin cannot read tenancies, rent, the ledger, complaints or SMS recipients. Admin power needs a verified authenticator code, checked by the database itself.
- Strangers can read only the public listings view: no landlord, phone, email or exact location. Full houses and locked landlords vanish from it.
- Tenants see only their own tenancy, balance, payments and notices.
- A suspended or expired landlord is locked out, and so are their tenants.

**Accounts**
- Roles and account state cannot be self-edited. A user cannot choose a role at sign-up. Only the server creates tenant and admin logins.
- Tenant phone codes are stored only as keyed hashes, limited per phone and per network address, burn after five wrong tries, and expire in five minutes. Landlords verify email and provide a phone number for M-Pesa prompts; landlord phone numbers are not OTP-verified.
- Invite links carry a 256-bit secret stored only as a hash; they expire in 7 days and work once.
- ID and KRA files: private storage, own folder only, only while documents are requested, 12 files, 5 MB, JPG/PNG/PDF, never editable or deletable, checked by their real contents.

**Money**
- The ledger, charges, audit log, subscription payments, payout items and the Celcom ledger cannot be edited, deleted or emptied by anyone, including the database owner.
- One M-Pesa receipt is counted once; one payment attempt is credited once. Full amount only. Wrong amounts are held, not credited.
- A callback is believed only if its secret address matches, it matches a prompt we sent, and Safaricom confirms it when we ask directly.
- Rent paid to the wrong Paybill is refused or held: a landlord on the platform Paybill is never paid into someone's own Paybill, and the reverse.
- Landlord Daraja keys are tested with Safaricom, then stored encrypted (AES-256-GCM, bound to that landlord). No browser can read them, and the callback secret is never shown.
- A payout can be created once per ledger entry and cannot include reversed payments.
- At zero SMS balance a message fails and nothing is charged; a rejected message is refunded once.

**Functions and web**
- Every server function is private by default; a guard test lists everything a stranger or signed-in user can run.
- Server functions show people only the messages our own rules wrote. Cross-site calls are refused.
- Strict content policy and headers (`public/_headers`): scripts only from our own origin, no framing, camera/location/payment blocked.
- The build fails if a secret-looking name is placed where the browser would see it. Dev-only code is absent from the production bundle (checked).
- Photos are re-drawn in the browser, which removes hidden location data and shrinks them.
- No raw HTML insertion, no eval. Private data is cleared from memory on sign out and on any 401, and never retried on 4xx.
- Dependencies: 0 known vulnerabilities at build time. Re-run `npm audit` before each release.

## Known trade-offs
- The signed-in session token sits in the browser's local storage (the library default). The strict content policy is the defence. A cookie-based session needs a server in front.
- Google sign-in on any page creates a landlord account with no access until verification and payment.
- Public endpoints (viewing requests and invites) rely on open-request, per-house and per-network limits in the database. Viewing-request phone numbers are not OTP-verified. Add bot protection (for example Cloudflare Turnstile) before heavy traffic.
- An attacker who can request codes for many different phone numbers costs you KES 0.25 each. The per-network limit is the brake.
- `landlord_active(uuid)` tells a signed-in user whether a given landlord id is active. Ids are unguessable.

## If you find a problem
Fix it, add a test that would have caught it, and write one line here.
