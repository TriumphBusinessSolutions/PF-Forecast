-- Sample data to validate the Profit First Forecast dashboard wiring
-- Run after executing docs/supabase-schema.sql

with upsert_client as (
  insert into public.clients (id, name)
  values ('11111111-1111-4111-8111-111111111111', 'Demo Client Co.')
  on conflict (id) do update set name = excluded.name
  returning id
)
insert into public.pf_accounts (id, client_id, slug, name, color, sort_order)
select
  gen_random_uuid(),
  uc.id,
  slug,
  name,
  color,
  row_number() over ()
from upsert_client uc
cross join lateral (values
  ('income', 'Income', '#0EA5E9'),
  ('profit', 'Profit', '#6366F1'),
  ('owners_pay', "Owner's Pay", '#22C55E'),
  ('tax', 'Tax', '#F97316'),
  ('operating_expenses', 'Operating Expenses', '#A855F7')
) as accounts(slug, name, color)
on conflict (client_id, slug) do update set name = excluded.name, color = excluded.color;

-- Allocation targets effective this quarter
insert into public.allocation_targets (client_id, effective_date, pf_slug, pct)
select uc.id, date_trunc('quarter', current_date)::date, slug, pct
from upsert_client uc
join (values
  ('income', 1.0),
  ('profit', 0.1),
  ('owners_pay', 0.35),
  ('tax', 0.15),
  ('operating_expenses', 0.4)
) as targets(slug, pct) on true
on conflict (client_id, effective_date, pf_slug) do update set pct = excluded.pct;

-- Baseline allocation percentages
insert into public.allocation_current (client_id, pf_slug, pct)
select uc.id, slug, pct
from upsert_client uc
join (values
  ('income', 1.0),
  ('profit', 0.05),
  ('owners_pay', 0.3),
  ('tax', 0.15),
  ('operating_expenses', 0.5)
) as current(slug, pct) on true
on conflict (client_id, pf_slug) do update set pct = excluded.pct;

-- Rollout plan for the next four quarters
insert into public.allocation_rollout_steps (client_id, quarter_index, pf_slug, pct)
select uc.id, quarter_index, slug, pct
from upsert_client uc
join (values
  (1, 'profit', 0.06),
  (1, 'owners_pay', 0.31),
  (1, 'tax', 0.15),
  (1, 'operating_expenses', 0.48),
  (2, 'profit', 0.07),
  (2, 'owners_pay', 0.32),
  (2, 'tax', 0.15),
  (2, 'operating_expenses', 0.46),
  (3, 'profit', 0.08),
  (3, 'owners_pay', 0.33),
  (3, 'tax', 0.15),
  (3, 'operating_expenses', 0.44),
  (4, 'profit', 0.09),
  (4, 'owners_pay', 0.34),
  (4, 'tax', 0.15),
  (4, 'operating_expenses', 0.42)
) as rollout(quarter_index, slug, pct) on true
on conflict (client_id, quarter_index, pf_slug) do update set pct = excluded.pct;

-- Monthly balances and activity for the last six months
with months as (
  select to_char(date_trunc('month', current_date) - (interval '1 month' * g), 'YYYY-MM') as ym
  from generate_series(0, 5) as g
)
insert into public.pf_monthly_balances (client_id, ym, pf_slug, ending_balance)
select uc.id, m.ym, a.slug,
  case a.slug
    when 'income' then 10000 - (row_number() over (partition by a.slug order by m.ym) * 500)
    when 'profit' then 2500 + (row_number() over (partition by a.slug order by m.ym) * 250)
    when 'owners_pay' then 4000 + (row_number() over (partition by a.slug order by m.ym) * 150)
    when 'tax' then 3000 + (row_number() over (partition by a.slug order by m.ym) * 100)
    else 7000 - (row_number() over (partition by a.slug order by m.ym) * 300)
  end
from upsert_client uc
cross join months m
join public.pf_accounts a on a.client_id = uc.id
on conflict (client_id, ym, pf_slug) do update set ending_balance = excluded.ending_balance;

with months as (
  select to_char(date_trunc('month', current_date) - (interval '1 month' * g), 'YYYY-MM') as ym
  from generate_series(0, 5) as g
)
insert into public.pf_monthly_activity (client_id, ym, pf_slug, net_amount)
select uc.id, m.ym, a.slug,
  case a.slug
    when 'income' then 18000
    when 'profit' then 1500
    when "owners_pay" then 6000
    when 'tax' then 2700
    else -12000
  end
from upsert_client uc
cross join months m
join public.pf_accounts a on a.client_id = uc.id
on conflict (client_id, ym, pf_slug) do update set net_amount = excluded.net_amount;

-- Projected occurrences for drill-down charts
insert into public.pf_projected_occurrences (id, client_id, month_start, coa_account_id, kind, name, amount)
select gen_random_uuid(), uc.id, date_trunc('month', current_date) + (interval '1 month' * g),
  concat('GL-', 100 + g),
  case when g % 2 = 0 then 'invoice' else 'bill' end,
  case when g % 2 = 0 then 'Projected Invoice' else 'Projected Expense' end,
  case when g % 2 = 0 then 7500 else -4200 end
from upsert_client uc
cross join generate_series(0, 3) as g
on conflict do nothing;

-- Custom projections added from the UI
insert into public.pf_custom_projections (id, client_id, pf_slug, period, granularity, name, amount, direction, frequency, escalation, escalation_value, start_date)
select gen_random_uuid(), uc.id, 'operating_expenses', '2024-Q4', 'monthly', 'Marketing Push', 1500, 'outflow', 'monthly', 'fixed', null, date_trunc('month', current_date)
from upsert_client uc
on conflict do nothing;
