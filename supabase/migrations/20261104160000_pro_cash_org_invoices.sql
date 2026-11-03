-- 🧾 PRO-CASH C4.4 — céges számla és átutalásos fizetés (PRO-CASH 5.2).
--
-- A szervezet owner/adminja átutalásos számlát kér (`org_request_invoice`): a nettó ár a
-- fejenkénti Coin-ár × ülés × hónap, euróban 1 Coin = 5 € (nettó). Az ÁFA-kezelést (HU 27% /
-- EU fordított adózás / EU-n kívül) a worker számla-magja dönti el (server/invoice.js) és adja át;
-- a sorszám évente folyamatos (RMX-<év>-<6 jegy>, hézag nélkül, zárolt számlálóval).
-- A beérkezett átutalás után a `finance.manage` admin „fizetve”-re állítja (`invoice_mark_paid`),
-- és ez aktiválja a Vállalati előfizetést (`source = 'invoice'`), Coin-terhelés nélkül.

create table if not exists public.invoice_counters (
  year integer primary key,
  last integer not null default 0
);
alter table public.invoice_counters enable row level security;

create table if not exists public.invoices (
  id          uuid primary key default gen_random_uuid(),
  number      text not null unique,
  org_id      uuid not null references public.organizations (id) on delete restrict,
  months      integer not null check (months in (1, 12)),
  seats       integer not null check (seats >= 2),
  net_cents   bigint not null,
  vat_pct     integer not null,
  vat_cents   bigint not null,
  gross_cents bigint not null,
  vat_code    text not null,
  currency    text not null default 'EUR',
  method      text not null default 'transfer' check (method in ('transfer', 'coins')),
  status      text not null default 'open' check (status in ('open', 'paid', 'void')),
  buyer       jsonb not null,
  issued_at   timestamptz not null default now(),
  due_at      timestamptz not null,
  paid_at     timestamptz
);
create index if not exists invoices_org_idx on public.invoices (org_id, issued_at desc);
alter table public.invoices enable row level security;
drop policy if exists "invoices_select_org_admin" on public.invoices;
create policy "invoices_select_org_admin" on public.invoices for select using (
  org_id = public.my_org_id() and public.org_role(org_id, auth.uid()) in ('owner', 'admin')
);

-- 1 cent-Coin nettó értéke euró-centben (1 Coin = 5 €)
create or replace function public.coin_net_eur_cents(p_cents bigint)
returns bigint language sql immutable set search_path = '' as $$ select p_cents * 5; $$;

create or replace function public.next_invoice_number(p_at timestamptz default now())
returns text language plpgsql security definer set search_path = '' as $$
declare v_year integer := extract(year from p_at)::int; v_n integer;
begin
  insert into public.invoice_counters (year, last) values (v_year, 1)
    on conflict (year) do update set last = public.invoice_counters.last + 1
    returning last into v_n;
  return 'RMX-' || v_year || '-' || lpad(v_n::text, 6, '0');
end; $$;
revoke all on function public.next_invoice_number(timestamptz) from public, anon, authenticated;

-- a worker hívja (service_role), a hívó jogosultságát ő ellenőrizte; az ÁFA-kódot és -kulcsot
-- a számla-mag adja (a vevő országa és VIES-eredménye alapján)
create or replace function public.issue_org_invoice(
  p_org uuid, p_months integer, p_seats integer, p_vat_pct integer, p_vat_code text, p_buyer jsonb, p_due_days integer default 15
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.organizations%rowtype; v_net bigint; v_vat bigint; v_id uuid; v_number text;
begin
  select * into o from public.organizations where id = p_org;
  if not found then raise exception 'not_found'; end if;
  if o.status <> 'verified' then raise exception 'org_not_verified'; end if;
  if p_months not in (1, 12) or p_seats < 2 then raise exception 'invalid params'; end if;
  if p_seats < (select count(*) from public.org_members where org_id = p_org) then raise exception 'seats_below_members'; end if;
  v_net := public.coin_net_eur_cents(public.org_seat_price_cents(p_org, p_seats) * p_seats * (case when p_months = 12 then 10 else 1 end));
  v_vat := round(v_net * p_vat_pct / 100.0)::bigint;
  v_number := public.next_invoice_number();
  insert into public.invoices (number, org_id, months, seats, net_cents, vat_pct, vat_cents, gross_cents, vat_code, buyer, due_at)
    values (v_number, p_org, p_months, p_seats, v_net, p_vat_pct, v_vat, v_net + v_vat, p_vat_code, p_buyer,
            now() + (p_due_days || ' days')::interval)
    returning id into v_id;
  return jsonb_build_object('id', v_id, 'number', v_number, 'net_cents', v_net, 'vat_cents', v_vat, 'gross_cents', v_net + v_vat);
end; $$;
revoke all on function public.issue_org_invoice(uuid, integer, integer, integer, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.issue_org_invoice(uuid, integer, integer, integer, text, jsonb, integer) to service_role;

-- beérkezett átutalás → fizetve, és a Vállalati előfizetés aktiválása (pénzügyi admin)
create or replace function public.invoice_mark_paid(p_invoice uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare i public.invoices%rowtype; o public.organizations%rowtype; s public.subscriptions%rowtype; v_end timestamptz; v_period text;
begin
  if auth.uid() is null or not public.has_permission(auth.uid(), 'finance.manage') then raise exception 'forbidden'; end if;
  select * into i from public.invoices where id = p_invoice for update;
  if not found then raise exception 'not_found'; end if;
  if i.status = 'paid' then return jsonb_build_object('status', 'paid', 'unchanged', true); end if;
  if i.status <> 'open' then raise exception 'invoice_not_open'; end if;
  select * into o from public.organizations where id = i.org_id;
  v_period := case when i.months = 12 then 'year' else 'month' end;
  insert into public.subscriptions (user_id) values (o.owner_id) on conflict (user_id) do nothing;
  select * into s from public.subscriptions where user_id = o.owner_id for update;
  -- a még futó szervezeti periódust toldjuk, különben mostantól
  v_end := (case when s.org_id = o.id and s.tier = 'business' and s.current_period_end > now() then s.current_period_end else now() end)
           + public.period_interval(v_period);
  update public.subscriptions set tier = 'business', seats = i.seats, org_id = o.id, status = 'active', source = 'invoice',
         billing_period = v_period, period_start = coalesce(case when s.current_period_end > now() then s.period_start end, now()),
         current_period_end = v_end, tier_charge_cents = 0, auto_renew = false, pending_tier = null, pending_seats = null
   where user_id = o.owner_id;
  update public.invoices set status = 'paid', paid_at = now() where id = p_invoice;
  return jsonb_build_object('status', 'paid', 'until', v_end);
end; $$;
revoke all on function public.invoice_mark_paid(uuid) from public, anon;
grant execute on function public.invoice_mark_paid(uuid) to authenticated;

-- a jóváhagyásra váró szervezetek és a nyitott számlák (pénzügyi admin)
create or replace function public.orgs_pending_review()
returns table (id uuid, name text, country text, vat_id text, reg_number text, domain text, verification jsonb, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_permission(auth.uid(), 'finance.manage') then raise exception 'forbidden'; end if;
  return query select o.id, o.name, o.country, o.vat_id, o.reg_number, o.domain, o.verification, o.created_at
    from public.organizations o where o.status = 'pending' order by o.created_at;
end; $$;
revoke all on function public.orgs_pending_review() from public, anon;
grant execute on function public.orgs_pending_review() to authenticated;

create or replace function public.invoices_open()
returns table (id uuid, number text, org_name text, gross_cents bigint, due_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_permission(auth.uid(), 'finance.manage') then raise exception 'forbidden'; end if;
  return query select i.id, i.number, o.name, i.gross_cents, i.due_at
    from public.invoices i join public.organizations o on o.id = i.org_id where i.status = 'open' order by i.due_at;
end; $$;
revoke all on function public.invoices_open() from public, anon;
grant execute on function public.invoices_open() to authenticated;
