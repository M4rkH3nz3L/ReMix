import { cloudBaseUrl } from '@/lib/backend';
import { makeId } from '@/lib/id';
import { migrateProject } from '@/lib/projectUtils';
import { requireSupabase, supabase } from '@/lib/supabase';
import { saveProject } from '@/lib/storage';
import { workerJsonHeaders } from '@/lib/workerAuth';
import { useAuth } from '@/store/authStore';
import type { Project } from '@/types/project';
import { logCaught } from '@/lib/logCaught';
import { packFromProject, parseSoundPack } from '@/lib/soundPack';
import { useSoundPacks } from '@/store/soundPackStore';

/**
 * 🛒 Shop / marketplace kliens-réteg — a userek eladásai (sablon/asset-csomagok)
 * kredit-alapú (Facebook-Stars-modell) piactere.
 *
 * A kredit-egyenleg SZERVER-HITELES (user_credits, RLS csak olvasás). Feltöltés a
 * worker /shop/credits/grant-ján (dev) vagy RevenueCat consumable (élesben). A
 * vásárlás az ATOMIKUS `purchase_shop_item` RPC-n megy (levon/jóváír/rögzít +
 * visszaadja a payloadot). A payload (a tényleges tartalom) RLS-gate-elt: csak az
 * eladó vagy aki megvette olvashatja.
 */

export type ShopKind = 'template' | 'overlay' | 'lut' | 'sfx' | 'sticker' | 'font' | 'preset' | 'soundpack';
export const SHOP_KINDS: ShopKind[] = ['template', 'soundpack', 'overlay', 'lut', 'sfx', 'sticker', 'font', 'preset'];

export interface ShopItem {
  id: string;
  sellerId: string;
  title: string;
  description?: string;
  kind: ShopKind;
  category?: string;
  priceCents: number;
  previewUrl?: string;
  sellerName?: string;
  downloads: number;
  rating: number;
  status: string;
  createdAt: string;
}

interface ItemRow {
  id: string;
  seller_id: string;
  title: string;
  description: string | null;
  kind: string;
  category: string | null;
  price_cents: number;
  preview_url: string | null;
  seller_name: string | null;
  downloads: number;
  rating: number;
  status: string;
  created_at: string;
}

const ITEM_COLUMNS =
  'id, seller_id, title, description, kind, category, price_cents, preview_url, seller_name, downloads, rating, status, created_at';

function toItem(r: ItemRow): ShopItem {
  return {
    id: r.id,
    sellerId: r.seller_id,
    title: r.title,
    description: r.description ?? undefined,
    kind: (r.kind as ShopKind) ?? 'template',
    category: r.category ?? undefined,
    priceCents: r.price_cents,
    previewUrl: r.preview_url ?? undefined,
    sellerName: r.seller_name ?? undefined,
    downloads: r.downloads,
    rating: r.rating,
    status: r.status,
    createdAt: r.created_at,
  };
}

export function currentUserId(): string | null {
  return useAuth.getState().user?.id ?? null;
}

/** Publikált tételek (opcionális típus-szűrővel), legújabb / legnépszerűbb elöl. */
export async function listShopItems(opts?: {
  kind?: ShopKind;
  sort?: 'new' | 'popular';
}): Promise<ShopItem[]> {
  const sb = requireSupabase();
  let q = sb.from('shop_items').select(ITEM_COLUMNS).eq('status', 'published');
  if (opts?.kind) {
    q = q.eq('kind', opts.kind);
  }
  q =
    opts?.sort === 'popular'
      ? q.order('downloads', { ascending: false })
      : q.order('created_at', { ascending: false });
  const { data, error } = await q.limit(100);
  if (error) {
    throw new Error(error.message);
  }
  return (data as ItemRow[]).map(toItem);
}

/** A saját feltöltéseim (eladóként). */
export async function myListings(): Promise<ShopItem[]> {
  const sb = requireSupabase();
  const uid = currentUserId();
  if (!uid) {
    return [];
  }
  const { data, error } = await sb
    .from('shop_items')
    .select(ITEM_COLUMNS)
    .eq('seller_id', uid)
    .order('created_at', { ascending: false });
  if (error) {
    throw new Error(error.message);
  }
  return (data as ItemRow[]).map(toItem);
}

export interface PurchasedItem {
  item: ShopItem;
  purchasedAt: string;
}

/** A megvett tételeim (a payloadhoz hozzáférek → „használd a projektben"). */
export async function myPurchases(): Promise<PurchasedItem[]> {
  const sb = requireSupabase();
  const uid = currentUserId();
  if (!uid) {
    return [];
  }
  const { data, error } = await sb
    .from('shop_purchases')
    .select(`created_at, item:shop_items(${ITEM_COLUMNS})`)
    .eq('buyer_id', uid)
    .order('created_at', { ascending: false });
  if (error) {
    throw new Error(error.message);
  }
  return ((data ?? []) as unknown as { created_at: string; item: ItemRow | null }[])
    .filter((r) => r.item)
    .map((r) => ({ item: toItem(r.item as ItemRow), purchasedAt: r.created_at }));
}

/** Az összes egyenlegem cent-Coinban (0, ha nincs sor / nincs backend). A bontás: wallet.fetchWallet. */
export async function creditBalance(): Promise<number> {
  const uid = currentUserId();
  if (!supabase || !uid) {
    return 0;
  }
  const { data } = await supabase
    .from('user_credits')
    .select('balance')
    .eq('user_id', uid)
    .maybeSingle();
  return (data?.balance as number | undefined) ?? 0;
}

/** Már megvettem-e (vagy én adom el) ezt a tételt. */
export async function ownsItem(item: ShopItem): Promise<boolean> {
  const uid = currentUserId();
  if (!uid) {
    return false;
  }
  if (item.sellerId === uid) {
    return true;
  }
  const sb = requireSupabase();
  const { data } = await sb
    .from('shop_purchases')
    .select('id')
    .eq('item_id', item.id)
    .eq('buyer_id', uid)
    .maybeSingle();
  return !!data;
}

/** 18 év alatt a havi Coin-költés korlátos (PRO-CASH 8.5). */
export class MinorLimitError extends Error {
  constructor() {
    super('minor_monthly_limit');
    this.name = 'MinorLimitError';
  }
}

export class InsufficientCreditsError extends Error {
  constructor() {
    super('insufficient_credits');
    this.name = 'InsufficientCreditsError';
  }
}

/**
 * Tétel megvásárlása az atomikus RPC-n. Visszaadja a payloadot (a tartalmat).
 * Kevés kredit → InsufficientCreditsError (a UI a kredit-vásárlásra irányít).
 */
export async function purchaseItem(itemId: string): Promise<unknown> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('purchase_shop_item', { p_item: itemId });
  if (error) {
    if (/minor_monthly_limit/.test(error.message)) {
      throw new MinorLimitError();
    }
    if (/insufficient_credits/.test(error.message)) {
      throw new InsufficientCreditsError();
    }
    throw new Error(error.message);
  }
  return data;
}

/** Egy birtokolt tétel payloadja (RLS: eladó/vevő) — pl. újbóli használathoz. */
export async function getPayload(itemId: string): Promise<unknown | null> {
  const sb = requireSupabase();
  const { data } = await sb
    .from('shop_item_payloads')
    .select('payload')
    .eq('item_id', itemId)
    .maybeSingle();
  return data?.payload ?? null;
}

/**
 * Publikálás: a saját PROJEKTEMBŐL sablon-tétel. A payload a projekt JSON-je
 * (a médiafájlok nélkül is működő szerkezet); vásárláskor új projektként jön létre.
 */
export async function publishProjectAsItem(
  project: Project,
  meta: { title: string; description?: string; priceCents: number; kind?: ShopKind; category?: string; previewUrl?: string },
  /** 🛍️ V4: más tartalom a projekt-JSON helyett (pl. a projektből képzett hangcsomag) */
  payloadOverride?: unknown
): Promise<ShopItem> {
  const sb = requireSupabase();
  const uid = currentUserId();
  if (!uid) {
    throw new Error('Nincs bejelentkezett felhasználó.');
  }
  const user = useAuth.getState().user;
  const { data, error } = await sb
    .from('shop_items')
    .insert({
      seller_id: uid,
      title: meta.title,
      description: meta.description ?? null,
      kind: meta.kind ?? 'template',
      category: meta.category ?? null,
      price_cents: Math.max(0, Math.trunc(meta.priceCents)),
      preview_url: meta.previewUrl ?? null,
      seller_name: user?.email ?? null,
      status: 'published',
    })
    .select(ITEM_COLUMNS)
    .single();
  if (error) {
    throw new Error(error.message);
  }
  const item = toItem(data as ItemRow);
  // a payload a projekt JSON-je (id és saját eredet nélkül — importkor újat generálunk)
  const payload = payloadOverride ?? { type: 'project', project: { ...project, id: undefined, shopOrigin: undefined } };
  const { error: pErr } = await sb.from('shop_item_payloads').insert({ item_id: item.id, payload });
  if (pErr) {
    // a payload nélkül a tétel használhatatlan → visszavonjuk
    await sb.from('shop_items').delete().eq('id', item.id);
    throw new Error(pErr.message);
  }
  // 🔀 megvett sablonból készült → az eredeti alkotó remix-jutalékot kap (PRO-CASH 6.1); a
  // szerver ellenőrzi, hogy tényleg megvette-e, és nem a sajátja-e — hiba esetén a tétel él tovább
  if (project.shopOrigin?.itemId && project.shopOrigin.itemId !== item.id) {
    const { error: oErr } = await sb.rpc('set_item_origin', { p_item: item.id, p_origin: project.shopOrigin.itemId });
    if (oErr) {
      logCaught('lib/shop.ts:publishProjectAsItem:origin', oErr);
    }
  }
  return item;
}

/** Levesz egy saját tételt a piacról (státusz → removed). */
export async function unpublishItem(itemId: string): Promise<void> {
  const sb = requireSupabase();
  await sb.from('shop_items').update({ status: 'removed' }).eq('id', itemId);
}

/**
 * Egy megvett/publikált SABLON payload → ÚJ helyi projekt (a szerkesztőben nyílik).
 * Visszaadja az új projekt id-ját, vagy null, ha a payload nem projekt-sablon.
 */
export async function importPayloadAsProject(payload: unknown, itemId?: string): Promise<string | null> {
  const p = payload as { type?: string; project?: Project } | null;
  if (!p || p.type !== 'project' || !p.project) {
    return null;
  }
  const project = migrateProject({
    ...(p.project as Project),
    id: makeId('prj'),
    // a megvett sablon eredete (a remix-jutalékhoz); a saját korábbi eredetét felülírja
    ...(itemId ? { shopOrigin: { itemId } } : {}),
  });
  await saveProject(project);
  return project.id;
}

/**
 * DEV/manuális feltöltés a worker /shop/credits/grant-ján: `amount` Coin a VÁSÁROLT
 * alegyenlegre. Az ÉLES feltöltés a RevenueCat consumable (`coins_<n>` csomag) →
 * webhook. Visszaadja az új egyenleget (cent-Coin).
 */
export async function buyCreditsDev(amount: number): Promise<number> {
  const userId = currentUserId();
  if (!userId) {
    throw new Error('Nincs bejelentkezett felhasználó.');
  }
  // 🔐 a worker a userId-t a VERIFIKÁLT tokenből veszi (a body-beli csak dev-fallback)
  const res = await fetch(`${cloudBaseUrl()}/shop/credits/grant`, {
    method: 'POST',
    headers: await workerJsonHeaders(),
    body: JSON.stringify({ userId, amount }),
  });
  if (!res.ok) {
    const msg = await res.text().catch((caught) => { logCaught('lib/shop.ts:buyCreditsDev', caught); return ''; });
    throw new Error(msg || 'A kredit-feltöltés nem sikerült.');
  }
  const data = (await res.json()) as { balance?: number };
  return data.balance ?? 0;
}

/**
 * 🛍️ V4: hangcsomag eladása a SAJÁT projektből — a projekt dob- és szinti-mintái lesznek a loopok.
 * `null`, ha a projektben nincs hangszer-minta (nincs mit eladni).
 */
export async function publishSoundPack(
  project: Project,
  meta: { title: string; description?: string; priceCents: number }
): Promise<ShopItem | null> {
  const pack = packFromProject(project, meta.title);
  if (!pack) {
    return null;
  }
  const item = await publishProjectAsItem(project, { ...meta, kind: 'soundpack', category: 'audio' }, pack);
  // az eladó is használhatja a saját csomagját a loop-könyvtárban
  useSoundPacks.getState().addPack(item.id, pack);
  return item;
}

/** 🛍️ V4: egy megvett tétel payloadja hangcsomagként a telefonra (ellenőrizve); `false`, ha nem az */
export function storeSoundPack(itemId: string, payload: unknown): boolean {
  const pack = parseSoundPack(payload);
  if (!pack) {
    return false;
  }
  useSoundPacks.getState().addPack(itemId, pack);
  return true;
}

/**
 * 🛍️ V4: a fiókom megvett (és saját) hangcsomagjai a telefonra — új eszközön / újratelepítés után a
 * loop-könyvtár így kapja vissza őket. Best-effort: kijelentkezve / offline nem csinál semmit.
 */
export async function syncOwnedSoundPacks(): Promise<number> {
  if (!supabase || !currentUserId()) {
    return 0;
  }
  const have = new Set(useSoundPacks.getState().packs.map((p) => p.itemId));
  const [bought, mine] = await Promise.all([myPurchases(), myListings()]);
  const items = [...bought.map((b) => b.item), ...mine].filter((i) => i.kind === 'soundpack' && !have.has(i.id));
  let added = 0;
  for (const it of items) {
    if (storeSoundPack(it.id, await getPayload(it.id))) added++;
  }
  return added;
}
