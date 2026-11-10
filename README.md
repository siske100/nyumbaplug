# HousePlug Kenya

HousePlug Kenya helps people find rental homes, book viewings, and manage properties across Kenya.

## Project

- `apps/web` — React + TypeScript website for public listings, landlords, tenants, and administrators.
- `packages/shared` — rules shared by the website and Supabase functions.
- `supabase` — database migrations, Edge Functions, scheduled jobs, and tests.
- `docs` — architecture, security, payment, and launch guidance.

The website uses Supabase for its backend, M-Pesa Daraja for supported payments, and Celcom for SMS.

## Run locally

```bash
npm install
npm run dev
npm test
npm run build
```

Configure `apps/web/.env` to connect to Supabase. Without backend settings, the app uses a limited development stand-in. See [supabase/README.md](./supabase/README.md) for backend setup, then [docs/LAUNCH-CHECKLIST.md](./docs/LAUNCH-CHECKLIST.md) before deployment.
