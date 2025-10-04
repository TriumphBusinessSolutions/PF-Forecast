# PF-Forecast

Profit First cash flow forecast dashboard powered by Next.js and Supabase.

## Getting started

1. Install dependencies
   ```bash
   npm install
   ```
2. Create a `.env.local` file with your Supabase project credentials:
   ```bash
   NEXT_PUBLIC_SUPABASE_URL=your-project-url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   ```
3. Apply the database schema found in [`docs/supabase-schema.sql`](docs/supabase-schema.sql) to your Supabase project. The schema creates the tables and views that the dashboard reads, such as `clients`, `pf_accounts`, allocation targets, and the monthly balance/activity views used throughout the UI.
4. (Optional) Load the sample fixtures in [`docs/supabase-test-fixtures.sql`](docs/supabase-test-fixtures.sql) to validate the end-to-end Supabase connection with representative data before wiring in your production sources.

See [the Supabase sync checklist](docs/supabase-sync-guide.md) for a step-by-step walkthrough on verifying that the database and every page in the app can exchange data with Supabase.
4. Start the development server
   ```bash
   npm run dev
   ```

## Database overview

The UI reads and writes to several Supabase tables:

- `clients` – list of Profit First clients displayed in the scenario picker.【F:app/page.tsx†L186-L213】
- `pf_accounts` – stores the core and custom Profit First accounts per client.【F:app/page.tsx†L198-L214】【F:app/page.tsx†L528-L552】
- `coa_to_pf_map` – links chart-of-account ids to Profit First buckets for drill-down reporting.【F:app/page.tsx†L207-L214】【F:app/page.tsx†L404-L419】
- `allocation_targets` – persists the target allocation percentages by effective date.【F:app/page.tsx†L216-L241】【F:app/page.tsx†L840-L872】
- `allocation_current` – tracks the client's current baseline percentages that seed rollout recommendations.【F:app/settings/page.tsx†L308-L344】【F:app/settings/page.tsx†L1201-L1208】【F:docs/supabase-schema.sql†L75-L102】
- `allocation_rollout_steps` – stores the quarter-by-quarter plan that transitions from current to target allocations.【F:app/settings/page.tsx†L346-L360】【F:app/settings/page.tsx†L1213-L1232】【F:docs/supabase-schema.sql†L104-L132】
- `v_monthly_activity_long` – view returning monthly net activity per Profit First account.【F:app/page.tsx†L234-L241】【F:app/page.tsx†L272-L323】
- `v_pf_balances_long` – view returning month-end balances per Profit First account.【F:app/page.tsx†L239-L241】【F:app/page.tsx†L296-L338】
- `v_proj_occurrences` – view powering the inflow/outflow breakdown in the drill-down panel.【F:app/page.tsx†L404-L419】【F:app/page.tsx†L1384-L1426】
- `pf_custom_projections` – captures custom inflow/outflow adjustments created from the account drill-down and keeps them in sync with Supabase.【F:app/page.tsx†L234-L241】【F:app/page.tsx†L642-L708】【F:app/page.tsx†L683-L721】【F:docs/supabase-schema.sql†L79-L108】

Use the provided SQL file as a starting point and adapt it to match your production data sources (e.g., syncs from an accounting ledger). Configure row level security policies in Supabase to scope each table to the authenticated client owner before going live.
