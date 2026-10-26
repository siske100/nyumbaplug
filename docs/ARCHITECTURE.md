# Architecture

**Browser** (`apps/web`): screens only. Never trusted. React, TypeScript, TanStack Query, Tailwind. Areas load only when opened.
**Database** (`supabase/migrations`): who may see and do what, and every money rule. 11 migrations.
**Server functions** (`supabase/functions`): hold all secrets, talk to Safaricom and Celcom, and run scheduled jobs.
**Shared rules** (`packages/shared`): the checks (phones, passwords, houses, tenants, files, pricing, SMS sizing, device level) used by both browser and server.

## Account journeys
- **Landlord:** sign up, confirm email (code), confirm phone (SMS code), upload ID and KRA, admin approves, pay the first month by M-Pesa, active.
- **Tenant / caretaker:** a landlord invites them. They open the link, create a login, confirm the phone, and use their area.
- **Admin:** created by hand, authenticator code required for every session.
- **Visitor:** no account or phone code. Shares contact details and preferred viewing time; the landlord reaches out.

## Areas
| Who | Pages |
|---|---|
| Public | browse, house with photos, viewing request, sign in, landlord sign up, invite |
| Landlord | overview, houses, viewings, tenants (agreement, electricity), caretakers, payments, M-Pesa setup, SMS, plan, complaints, notices |
| Tenant | pay rent, complaints, documents, notices |
| Caretaker | complaints, tenants (no money) |
| Admin | overview, documents, viewings, subscriptions, payments, payouts, Celcom |

## Device adaptation
Three levels chosen automatically from memory, CPU, data-saver and reduced-motion settings: lite (solid panels, no animation), standard, rich (full glass, lit windows, cursor light). Cursor effects run only on devices with a mouse. See `lib/device.ts` and `packages/shared/src/device.ts`.
