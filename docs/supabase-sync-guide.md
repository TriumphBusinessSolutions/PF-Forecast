# Supabase Sync Checklist

Use this guide to confirm that the Profit First Forecast dashboard can read and write data to your Supabase project after applying the latest database updates.

## 1. Configure environment variables

Create an `.env.local` file in the project root with your Supabase credentials:

```
NEXT_PUBLIC_SUPABASE_URL="https://<your-project>.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="<anon-key>"
```

Restart the Next.js dev server after saving the file so that the new environment variables are picked up.

## 2. Apply the core schema

Run the SQL in [`docs/supabase-schema.sql`](./supabase-schema.sql) against your Supabase database. The script provisions every table and view referenced in the UI (clients, Profit First accounts, allocation targets, balances, activity views, etc.).

If you make schema changes in Supabase, re-run the script locally to keep the checked-in version in sync.

## 3. Seed sample data (optional but recommended)

Execute [`docs/supabase-test-fixtures.sql`](./supabase-test-fixtures.sql) to insert a representative client, account catalog, allocation targets, balances, and activity so that every page of the dashboard has data to render. This lets you confirm the UI wiring before integrating real production feeds.

## 4. Validate the connection from the app

With the dev server running (`npm run dev`), load the following routes and ensure data is present:

- `/` – Should display the demo client's balances, projections, and charts.
- `/settings` – Should list the client catalog, allocation targets, rollout plan, and allow saving updates.

If the UI shows a "Supabase is not configured" warning, double-check the environment variables in step 1.

## 5. Spot-check Supabase reads and writes

Use the Supabase SQL editor or `psql` to verify that the tables reflect actions taken in the UI:

- Creating or editing allocations in the **Settings → Allocation Targets** section should upsert rows in `allocation_targets`.
- Saving rollout plans should write to both `allocation_current` and `allocation_rollout_steps`.
- Adding custom projections from the drill-down views should insert rows into `pf_custom_projections`.

You can confirm with queries such as:

```sql
select * from public.allocation_targets order by client_id, effective_date, pf_slug;
select * from public.allocation_rollout_steps order by client_id, quarter_index, pf_slug;
select * from public.pf_custom_projections order by created_at desc;
```

## 6. Automate regression checks

Once your Supabase instance has real data, consider adding nightly jobs or cron triggers that mirror production data into a staging schema. Re-running the fixture script and replaying UI flows against staging ensures that schema changes stay compatible with the app.

## 7. Troubleshooting tips

- Ensure row level security (RLS) policies allow the anon key to read/write the tables touched by the UI. Start by disabling RLS while testing, then add scoped policies.
- If you change column names or add tables, update the queries in `app/page.tsx` and `app/settings/page.tsx` accordingly.
- Inspect browser devtools → Network tab to confirm Supabase responses when debugging.

Following these steps ensures the dashboard, the updated main database, and Supabase stay in sync so you can confidently run data tests.
