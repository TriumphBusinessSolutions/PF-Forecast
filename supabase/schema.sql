-- Profit First Forecast Supabase schema
-- -------------------------------------
-- This script provisions the tables and views consumed by the web app.
-- Run in the Supabase SQL editor (or psql) as the Postgres superuser.

-- Extensions -----------------------------------------------------------
create extension if not exists "pgcrypto";

-- Core reference tables ------------------------------------------------
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.pf_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  slug text not null,
  name text not null,
  color text,
  sort_order int,
  created_at timestamptz not null default now(),
  unique (client_id, slug)
);

create index if not exists pf_accounts_client_sort_idx
  on public.pf_accounts (client_id, sort_order, name);

create table if not exists public.allocation_targets (
  client_id uuid not null references public.clients(id) on delete cascade,
  effective_date date not null,
  pf_slug text not null,
  pct numeric(6,4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (client_id, effective_date, pf_slug)
);

-- Chart of accounts mapping -------------------------------------------
create table if not exists public.coa_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  number text,
  created_at timestamptz not null default now()
);

create table if not exists public.coa_to_pf_map (
  client_id uuid not null references public.clients(id) on delete cascade,
  coa_account_id uuid not null references public.coa_accounts(id) on delete cascade,
  pf_slug text not null,
  created_at timestamptz not null default now(),
  primary key (client_id, coa_account_id)
);

create index if not exists coa_to_pf_map_client_idx
  on public.coa_to_pf_map (client_id, pf_slug);

-- Monthly actuals and balances ----------------------------------------
create table if not exists public.pf_monthly_activity (
  client_id uuid not null references public.clients(id) on delete cascade,
  ym char(7) not null check (ym ~ '^\\d{4}-\\d{2}$'),
  pf_slug text not null,
  net_amount numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  primary key (client_id, ym, pf_slug)
);

create index if not exists pf_monthly_activity_client_idx
  on public.pf_monthly_activity (client_id, ym);

create table if not exists public.pf_monthly_balances (
  client_id uuid not null references public.clients(id) on delete cascade,
  ym char(7) not null check (ym ~ '^\\d{4}-\\d{2}$'),
  pf_slug text not null,
  ending_balance numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  primary key (client_id, ym, pf_slug)
);

create index if not exists pf_monthly_balances_client_idx
  on public.pf_monthly_balances (client_id, ym);

-- Projected occurrences (cashflow drill-down) -------------------------
create table if not exists public.projected_occurrences (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  month_start date not null,
  coa_account_id uuid not null references public.coa_accounts(id) on delete cascade,
  kind text not null check (kind in ('inflow', 'outflow')),
  name text not null,
  amount numeric(14,2) not null,
  created_at timestamptz not null default now()
);

-- Helper function for updated_at columns ------------------------------
create or replace function public.set_current_timestamp()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_allocation_targets_updated_at'
  ) then
    create trigger set_allocation_targets_updated_at
      before update on public.allocation_targets
      for each row
      execute function public.set_current_timestamp();
  end if;
end $$;

-- Views consumed by the Next.js app -----------------------------------
create or replace view public.v_monthly_activity_long as
  select
    a.client_id,
    a.ym,
    a.pf_slug,
    a.net_amount
  from public.pf_monthly_activity a;

create or replace view public.v_pf_balances_long as
  select
    b.client_id,
    b.ym,
    b.pf_slug,
    b.ending_balance
  from public.pf_monthly_balances b;

create or replace view public.v_proj_occurrences as
  select
    o.client_id,
    o.month_start,
    o.coa_account_id,
    o.kind,
    o.name,
    o.amount
  from public.projected_occurrences o;

-- Optional sample seed -------------------------------------------------
-- Uncomment to create a demo client and the core Profit First accounts.
--
-- insert into public.clients (id, name)
-- values ('00000000-0000-0000-0000-000000000001', 'Demo Client')
-- on conflict (id) do nothing;
--
-- insert into public.pf_accounts (client_id, slug, name, sort_order, color)
-- values
--   ('00000000-0000-0000-0000-000000000001', 'operating', 'Operating', 10, '#64748b'),
--   ('00000000-0000-0000-0000-000000000001', 'profit', 'Profit', 20, '#fa9100'),
--   ('00000000-0000-0000-0000-000000000001', 'owners_pay', "Owner's Pay", 30, '#10b981'),
--   ('00000000-0000-0000-0000-000000000001', 'tax', 'Tax', 40, '#ef4444'),
--   ('00000000-0000-0000-0000-000000000001', 'vault', 'Vault', 50, '#8b5cf6')
-- on conflict do nothing;
--
-- insert into public.allocation_targets (client_id, effective_date, pf_slug, pct)
-- values
--   ('00000000-0000-0000-0000-000000000001', current_date, 'operating', 0.30),
--   ('00000000-0000-0000-0000-000000000001', current_date, 'profit', 0.05),
--   ('00000000-0000-0000-0000-000000000001', current_date, 'owners_pay', 0.50),
--   ('00000000-0000-0000-0000-000000000001', current_date, 'tax', 0.15)
-- on conflict do nothing;
