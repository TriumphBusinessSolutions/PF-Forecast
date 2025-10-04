# PF-Forecast

Profit First Cash Flow Forecast Repository

## Local development

1. Install dependencies with `npm install`.
2. Copy `.env.local.example` to `.env.local` and fill in your Supabase credentials.
3. Run the development server with `npm run dev`.

## Environment configuration

The application expects a Supabase project. Add the following variables to `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### Supabase schema bootstrap

Run the SQL below in the Supabase SQL editor to create the tables, views, and row-level security policies used by the app.

```sql
create extension if not exists "pgcrypto" with schema public;

-- Clients that belong to each authenticated user
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.clients enable row level security;
create policy "Owners can select their clients" on public.clients
  for select using (owner_id = auth.uid());
create policy "Owners can insert their clients" on public.clients
  for insert with check (owner_id = auth.uid());
create policy "Owners can update their clients" on public.clients
  for update using (owner_id = auth.uid());
create policy "Owners can delete their clients" on public.clients
  for delete using (owner_id = auth.uid());

-- Profit First accounts configured per client
create table if not exists public.pf_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  slug text not null,
  name text not null,
  color text,
  sort_order integer,
  inserted_at timestamptz not null default now(),
  unique (client_id, slug)
);

alter table public.pf_accounts enable row level security;
create policy "Read PF accounts for owned clients" on public.pf_accounts
  for select using (exists (
    select 1 from public.clients c where c.id = client_id and c.owner_id = auth.uid()
  ));
create policy "Manage PF accounts for owned clients" on public.pf_accounts
  for all using (exists (
    select 1 from public.clients c where c.id = client_id and c.owner_id = auth.uid()
  )) with check (exists (
    select 1 from public.clients c where c.id = client_id and c.owner_id = auth.uid()
  ));

-- Target allocation percentages per PF account and effective date
create table if not exists public.allocation_targets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  effective_date date not null,
  pf_slug text not null,
  pct numeric not null,
  inserted_at timestamptz not null default now(),
  unique (client_id, effective_date, pf_slug)
);

alter table public.allocation_targets enable row level security;
create policy "Manage allocation targets for owned clients" on public.allocation_targets
  for all using (exists (
    select 1 from public.clients c where c.id = client_id and c.owner_id = auth.uid()
  )) with check (exists (
    select 1 from public.clients c where c.id = client_id and c.owner_id = auth.uid()
  ));

-- Mapping from the chart of accounts to PF accounts
create table if not exists public.coa_to_pf_map (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  coa_account_id text not null,
  pf_slug text not null,
  unique (client_id, coa_account_id)
);

alter table public.coa_to_pf_map enable row level security;
create policy "Manage COA mapping for owned clients" on public.coa_to_pf_map
  for all using (exists (
    select 1 from public.clients c where c.id = client_id and c.owner_id = auth.uid()
  )) with check (exists (
    select 1 from public.clients c where c.id = client_id and c.owner_id = auth.uid()
  ));

-- Monthly inflow/outflow aggregates per PF account
create table if not exists public.cash_activity_monthly (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  month_start date not null,
  pf_slug text not null,
  net_amount numeric not null,
  unique (client_id, month_start, pf_slug)
);

alter table public.cash_activity_monthly enable row level security;
create policy "Manage activity for owned clients" on public.cash_activity_monthly
  for all using (exists (
    select 1 from public.clients c where c.id = client_id and c.owner_id = auth.uid()
  )) with check (exists (
    select 1 from public.clients c where c.id = client_id and c.owner_id = auth.uid()
  ));

-- Month-end balances per PF account
create table if not exists public.pf_balances_monthly (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  month_start date not null,
  pf_slug text not null,
  ending_balance numeric not null,
  unique (client_id, month_start, pf_slug)
);

alter table public.pf_balances_monthly enable row level security;
create policy "Manage balances for owned clients" on public.pf_balances_monthly
  for all using (exists (
    select 1 from public.clients c where c.id = client_id and c.owner_id = auth.uid()
  )) with check (exists (
    select 1 from public.clients c where c.id = client_id and c.owner_id = auth.uid()
  ));

-- Projected occurrences that power drill-downs
create table if not exists public.proj_occurrences (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  month_start date not null,
  coa_account_id text not null,
  kind text not null,
  name text not null,
  amount numeric not null
);

alter table public.proj_occurrences enable row level security;
create policy "Manage projections for owned clients" on public.proj_occurrences
  for all using (exists (
    select 1 from public.clients c where c.id = client_id and c.owner_id = auth.uid()
  )) with check (exists (
    select 1 from public.clients c where c.id = client_id and c.owner_id = auth.uid()
  ));

-- Views used by the UI
create or replace view public.v_monthly_activity_long as
  select
    client_id,
    to_char(month_start, 'YYYY-MM') as ym,
    pf_slug,
    net_amount
  from public.cash_activity_monthly;

create or replace view public.v_pf_balances_long as
  select
    client_id,
    to_char(month_start, 'YYYY-MM') as ym,
    pf_slug,
    ending_balance
  from public.pf_balances_monthly;

create or replace view public.v_proj_occurrences as
  select
    client_id,
    month_start,
    coa_account_id,
    kind,
    name,
    amount
  from public.proj_occurrences;
```

After running the script, seed each table with data for your clients (activity, balances, and projection occurrences) so the dashboard has information to display.
