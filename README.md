# Rental Houses Kenya

React + TypeScript + TanStack Query + Tailwind (orange and grey glass) on Supabase, with M-Pesa (Daraja) payments and Celcom SMS.

```
apps/web          the website: public, landlord, tenant, caretaker and admin areas
packages/shared   the rules shared by the website and the server
supabase/         database migrations, server functions, scheduled jobs, 197 tests' worth of proof
docs/             ARCHITECTURE, SECURITY, PAYMENTS, LAUNCH-CHECKLIST
```

## Run it
```bash
npm install
npm run dev          # the website (needs apps/web/.env, see supabase/README.md)
npm test             # 197 tests: shared rules, database, server functions
npm run build        # typecheck and production build
```
Without Supabase settings the site runs on a development stand-in that only shows the public pages and sign-in. Everything else needs the real backend.

**Start with `supabase/README.md`, then `docs/LAUNCH-CHECKLIST.md`.**
