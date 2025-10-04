-- Supabase schema for Profit First Forecast dashboard
-- Run this script inside your Supabase/Postgres project.

-- Enable pgcrypto for UUID generation if not already enabled
create extension if not exists "pgcrypto";

-- Core client table
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

comment on table public.clients is 'Profit First clients served by the forecasting dashboard.';

-- Profit First account catalog per client (core + custom buckets)
create table if not exists public.pf_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  slug text not null,
  name text not null,
  color text,
  sort_order integer,
  created_at timestamptz not null default now(),
  unique (client_id, slug)
);

comment on table public.pf_accounts is 'Named Profit First accounts configured for a client (core and custom).';

-- Map chart-of-account ids from the accounting ledger to Profit First buckets
create table if not exists public.coa_to_pf_map (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  coa_account_id text not null,
  pf_slug text not null,
  created_at timestamptz not null default now(),
  unique (client_id, coa_account_id),
  constraint coa_to_pf_map_pf_accounts_fk
    foreign key (client_id, pf_slug)
    references public.pf_accounts (client_id, slug)
    on delete cascade
);

comment on table public.coa_to_pf_map is 'Links external chart-of-account identifiers to Profit First accounts for drill-downs.';

-- Target allocation percentages by effective date
create table if not exists public.allocation_targets (
  client_id uuid not null references public.clients(id) on delete cascade,
  effective_date date not null,
  pf_slug text not null,
  pct numeric(6,5) not null check (pct >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint allocation_targets_pk primary key (client_id, effective_date, pf_slug),
  constraint allocation_targets_pf_accounts_fk
    foreign key (client_id, pf_slug)
    references public.pf_accounts (client_id, slug)
    on delete cascade
);

create or replace function public.touch_allocation_targets_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

create trigger trg_touch_allocation_targets_updated_at
before update on public.allocation_targets
for each row execute function public.touch_allocation_targets_updated_at();

comment on table public.allocation_targets is 'Current allocation targets used for automated allocations on the chosen cadence.';

-- Monthly net activity by Profit First bucket (source for v_monthly_activity_long)
create table if not exists public.pf_monthly_activity (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  ym char(7) not null check (ym ~ '^[0-9]{4}-[0-9]{2}$'),
  pf_slug text not null,
  net_amount numeric not null default 0,
  constraint pf_monthly_activity_unique unique (client_id, ym, pf_slug),
  constraint pf_monthly_activity_pf_accounts_fk
    foreign key (client_id, pf_slug)
    references public.pf_accounts (client_id, slug)
    on delete cascade
);

comment on table public.pf_monthly_activity is 'Aggregated inflows minus outflows for each Profit First account per month.';

-- Monthly ending balances by Profit First bucket (source for v_pf_balances_long)
create table if not exists public.pf_monthly_balances (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  ym char(7) not null check (ym ~ '^[0-9]{4}-[0-9]{2}$'),
  pf_slug text not null,
  ending_balance numeric not null default 0,
  constraint pf_monthly_balances_unique unique (client_id, ym, pf_slug),
  constraint pf_monthly_balances_pf_accounts_fk
    foreign key (client_id, pf_slug)
    references public.pf_accounts (client_id, slug)
    on delete cascade
);

comment on table public.pf_monthly_balances is 'Month-end balance snapshots for each Profit First account.';

-- Projected occurrences/inflows/outflows sourced for account drill-downs
create table if not exists public.pf_projected_occurrences (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  month_start date not null,
  coa_account_id text not null,
  kind text not null,
  name text not null,
  amount numeric not null,
  created_at timestamptz not null default now()
);

comment on table public.pf_projected_occurrences is 'Projected ledger occurrences supporting account drill-down inflow/outflow breakdowns.';

-- Custom projection overrides entered from the dashboard
create table if not exists public.pf_custom_projections (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  pf_slug text not null,
  period text not null,
  granularity text not null check (granularity in ('monthly', 'weekly')),
  name text not null,
  amount numeric not null check (amount >= 0),
  direction text not null check (direction in ('inflow', 'outflow')),
  frequency text,
  escalation text,
  escalation_value numeric,
  start_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pf_custom_projections_pf_accounts_fk
    foreign key (client_id, pf_slug)
    references public.pf_accounts (client_id, slug)
    on delete cascade
);

create or replace function public.touch_pf_custom_projections_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_touch_pf_custom_projections_updated_at on public.pf_custom_projections;
create trigger trg_touch_pf_custom_projections_updated_at
before update on public.pf_custom_projections
for each row execute function public.touch_pf_custom_projections_updated_at();

comment on table public.pf_custom_projections is 'User-entered inflow/outflow overrides captured from the dashboard experience.';

-- Views consumed directly by the Next.js dashboard -------------------------
create or replace view public.v_monthly_activity_long as
select client_id, ym, pf_slug, net_amount
from public.pf_monthly_activity;

create or replace view public.v_pf_balances_long as
select client_id, ym, pf_slug, ending_balance
from public.pf_monthly_balances;

create or replace view public.v_proj_occurrences as
select client_id, month_start, coa_account_id, kind, name, amount
from public.pf_projected_occurrences;

-- Recommended policies (adjust to your security requirements)
-- alter table public.clients enable row level security;
-- create policy "Clients are owner scoped" on public.clients
--   using (auth.uid() = owner_id);
