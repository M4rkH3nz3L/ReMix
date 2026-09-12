-- 🛒 Shop / marketplace — a userek a saját dolgaikat (sablon / overlay / LUT /
-- SFX / matrica / font / preset) árulhatják, mások megvehetik és HASZNÁLHATJÁK a
-- videóikban. Facebook-Stars-modell: kredit/coin (IAP-vel vett) a fizetőeszköz,
-- a platform jutalékot von, az alkotó kreditet gyűjt.
--
-- SZERVER-HITELES pénz: a kredit-egyenleget SENKI nem írhatja kliensről (RLS csak
-- olvasás). Feltöltés: `grant_credits` (service_role — IAP webhook/dev). Vásárlás:
-- `purchase_shop_item` RPC (SECURITY DEFINER, atomikus): levon a vevőtől, jóváír az
-- eladónak (jutalék levonva), rögzíti a vételt, és VISSZAADJA a payload-ot.
--
-- A payload (a tényleges eladott tartalom) KÜLÖN táblában van, RLS-sel: csak az
-- eladó vagy aki MEGVETTE olvashatja — így az előnézet publikus, a tartalom nem.

-- ── kredit-egyenleg (userenként) ──────────────────────────────────────────────
create table if not exists public.user_credits (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  balance    integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);
alter table public.user_credits enable row level security;
drop policy if exists "credits_select_own" on public.user_credits;
create policy "credits_select_own" on public.user_credits
  for select using (auth.uid() = user_id);
-- ÍRÁS-policy szándékosan NINCS: csak service_role / SECURITY DEFINER függvény írhat.

-- ── kredit-tranzakciók (napló) ────────────────────────────────────────────────
create table if not exists public.credit_transactions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  delta      integer not null,                 -- + jóváírás / − levonás
  kind       text not null check (kind in ('topup', 'purchase', 'sale', 'refund', 'payout')),
  ref_item   uuid,
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists credit_tx_user_idx on public.credit_transactions (user_id, created_at desc);
alter table public.credit_transactions enable row level security;
drop policy if exists "credit_tx_select_own" on public.credit_transactions;
create policy "credit_tx_select_own" on public.credit_transactions
  for select using (auth.uid() = user_id);

-- ── shop tételek (publikus metaadat + előnézet) ───────────────────────────────
create table if not exists public.shop_items (
  id            uuid primary key default gen_random_uuid(),
  seller_id     uuid not null references auth.users (id) on delete cascade,
  title         text not null,
  description   text,
  -- template | overlay | lut | sfx | sticker | font | preset
  kind          text not null default 'template',
  category      text,
  price_credits integer not null default 0 check (price_credits >= 0),
  preview_url   text,
  seller_name   text,                          -- denormalizált a listához
  downloads     integer not null default 0,
  rating        numeric not null default 0,
  -- draft | published | removed
  status        text not null default 'published' check (status in ('draft', 'published', 'removed')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists shop_items_pub_idx on public.shop_items (status, created_at desc);
create index if not exists shop_items_seller_idx on public.shop_items (seller_id, created_at desc);
alter table public.shop_items enable row level security;

-- publikált tételt bárki (bejelentkezett) lát; a sajátját a tulaj mindig
drop policy if exists "shop_items_select" on public.shop_items;
create policy "shop_items_select" on public.shop_items
  for select using (status = 'published' or seller_id = auth.uid());
-- feltöltés/módosítás/törlés: csak a saját tételét
drop policy if exists "shop_items_insert_own" on public.shop_items;
create policy "shop_items_insert_own" on public.shop_items
  for insert with check (seller_id = auth.uid());
drop policy if exists "shop_items_update_own" on public.shop_items;
create policy "shop_items_update_own" on public.shop_items
  for update using (seller_id = auth.uid()) with check (seller_id = auth.uid());
drop policy if exists "shop_items_delete_own" on public.shop_items;
create policy "shop_items_delete_own" on public.shop_items
  for delete using (seller_id = auth.uid());

-- ── vásárlások ────────────────────────────────────────────────────────────────
create table if not exists public.shop_purchases (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references public.shop_items (id) on delete cascade,
  buyer_id   uuid not null references auth.users (id) on delete cascade,
  price_paid integer not null default 0,
  created_at timestamptz not null default now(),
  unique (item_id, buyer_id)
);
create index if not exists shop_purchases_buyer_idx on public.shop_purchases (buyer_id, created_at desc);
alter table public.shop_purchases enable row level security;
-- a vevő a saját vásárlásait látja; az eladó a saját tételeinek vásárlásait
drop policy if exists "shop_purchases_select" on public.shop_purchases;
create policy "shop_purchases_select" on public.shop_purchases
  for select using (
    buyer_id = auth.uid()
    or exists (select 1 from public.shop_items i where i.id = item_id and i.seller_id = auth.uid())
  );
-- INSERT-policy szándékosan NINCS: a vétel a purchase_shop_item RPC-n megy (atomikus).

-- ── a tényleges tartalom (payload) — GATE-elt ─────────────────────────────────
create table if not exists public.shop_item_payloads (
  item_id uuid primary key references public.shop_items (id) on delete cascade,
  payload jsonb not null                       -- pl. projekt-sablon JSON / asset-leírás
);
alter table public.shop_item_payloads enable row level security;
-- olvasás: az eladó VAGY aki megvette (az előnézet publikus, a payload nem)
drop policy if exists "shop_payload_select" on public.shop_item_payloads;
create policy "shop_payload_select" on public.shop_item_payloads
  for select using (
    exists (select 1 from public.shop_items i where i.id = item_id and i.seller_id = auth.uid())
    or exists (
      select 1 from public.shop_purchases p
       where p.item_id = shop_item_payloads.item_id and p.buyer_id = auth.uid()
    )
  );
-- írás: csak az eladó
drop policy if exists "shop_payload_write" on public.shop_item_payloads;
create policy "shop_payload_write" on public.shop_item_payloads
  for all using (
    exists (select 1 from public.shop_items i where i.id = item_id and i.seller_id = auth.uid())
  ) with check (
    exists (select 1 from public.shop_items i where i.id = item_id and i.seller_id = auth.uid())
  );

-- ── kredit jóváírás (service_role: IAP top-up / dev / eladói jóváírás) ─────────
create or replace function public.grant_credits(
  p_user uuid, p_amount integer, p_kind text default 'topup', p_note text default null, p_ref uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare new_balance integer;
begin
  if p_amount is null or p_amount = 0 then
    raise exception 'amount required';
  end if;
  insert into public.user_credits (user_id, balance, updated_at)
    values (p_user, greatest(0, p_amount), now())
  on conflict (user_id) do update
    set balance = public.user_credits.balance + p_amount, updated_at = now();
  insert into public.credit_transactions (user_id, delta, kind, note, ref_item)
    values (p_user, p_amount, coalesce(p_kind, 'topup'), p_note, p_ref);
  select balance into new_balance from public.user_credits where user_id = p_user;
  return new_balance;
end;
$$;
revoke all on function public.grant_credits(uuid, integer, text, text, uuid) from public, anon, authenticated;
grant execute on function public.grant_credits(uuid, integer, text, text, uuid) to service_role;

-- ── vásárlás (atomikus): a BEJELENTKEZETT vevő hívja ──────────────────────────
-- levon a vevőtől, jóváír az eladónak (30% platform-jutalék levonva), rögzíti a
-- vételt + tranzakciókat, és VISSZAADJA a payload-ot. Ingyenes (0 kredit) tétel:
-- csak hozzáférést ad. Saját tételt / duplát nem enged.
create or replace function public.purchase_shop_item(p_item uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_buyer   uuid := auth.uid();
  v_item    public.shop_items%rowtype;
  v_balance integer;
  v_seller_share integer;
  v_payload jsonb;
begin
  if v_buyer is null then
    raise exception 'not authenticated';
  end if;
  select * into v_item from public.shop_items where id = p_item;
  if not found or v_item.status <> 'published' then
    raise exception 'item not available';
  end if;
  if v_item.seller_id = v_buyer then
    raise exception 'cannot buy own item';
  end if;
  if exists (select 1 from public.shop_purchases where item_id = p_item and buyer_id = v_buyer) then
    raise exception 'already owned';
  end if;

  if v_item.price_credits > 0 then
    select balance into v_balance from public.user_credits where user_id = v_buyer;
    v_balance := coalesce(v_balance, 0);
    if v_balance < v_item.price_credits then
      raise exception 'insufficient_credits';
    end if;
    -- vevő terhelése
    update public.user_credits set balance = balance - v_item.price_credits, updated_at = now()
      where user_id = v_buyer;
    insert into public.credit_transactions (user_id, delta, kind, ref_item, note)
      values (v_buyer, -v_item.price_credits, 'purchase', p_item, v_item.title);
    -- eladó jóváírása: ár − 30% platform-jutalék
    v_seller_share := v_item.price_credits - floor(v_item.price_credits * 30 / 100)::int;
    insert into public.user_credits (user_id, balance, updated_at)
      values (v_item.seller_id, v_seller_share, now())
    on conflict (user_id) do update
      set balance = public.user_credits.balance + v_seller_share, updated_at = now();
    insert into public.credit_transactions (user_id, delta, kind, ref_item, note)
      values (v_item.seller_id, v_seller_share, 'sale', p_item, v_item.title);
  end if;

  insert into public.shop_purchases (item_id, buyer_id, price_paid)
    values (p_item, v_buyer, v_item.price_credits);
  update public.shop_items set downloads = downloads + 1 where id = p_item;

  select payload into v_payload from public.shop_item_payloads where item_id = p_item;
  return v_payload;
end;
$$;
revoke all on function public.purchase_shop_item(uuid) from public, anon;
grant execute on function public.purchase_shop_item(uuid) to authenticated;

-- updated_at karbantartás
drop trigger if exists shop_items_set_updated_at on public.shop_items;
create trigger shop_items_set_updated_at
  before update on public.shop_items
  for each row execute function public.set_updated_at();

-- 🔴 realtime: élő listafrissítés (új tétel / eladás-számláló)
alter publication supabase_realtime add table public.shop_items;
