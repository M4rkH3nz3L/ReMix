import { hasSupabaseConfig, requireSupabase } from '@/lib/supabase';
import { useAuth } from '@/store/authStore';

/**
 * 🤖 Felhasználói AI-modell konfigurációk (BYOK) — a `public.user_ai_providers`
 * tábla kliens-oldali rétege. RLS: mindenki csak a sajátját.
 *
 * Ebben a körben ez CSAK a konfiguráció kezelése (CRUD + alapértelmezett). A
 * tényleges AI-hívás átirányítása a kiválasztott modellre külön lépés (a
 * workert is érinti) — lásd README / auth-jegyzet.
 */

/** Támogatott provider-fajták. A `custom` bármely OpenAI-kompatibilis végpont. */
export type AiProviderKind = 'openai' | 'anthropic' | 'ollama' | 'custom';

export interface AiProvider {
  id: string;
  label: string;
  provider: AiProviderKind;
  /** API-végpont; üres = a fajta alapértelmezett címe (`defaultBaseUrl`) */
  baseUrl: string;
  model: string;
  /** API-kulcs (Ollama/lokális esetén üres is lehet) */
  apiKey: string;
  isDefault: boolean;
}

/** Új provider bevitele (id/isDefault nélkül). */
export type AiProviderInput = Omit<AiProvider, 'id' | 'isDefault'>;

/** Provider-fajta metaadatok: címke, alap-endpoint, példa-modell, kell-e kulcs. */
export const AI_PROVIDER_KINDS: Record<
  AiProviderKind,
  { defaultBaseUrl: string; sampleModel: string; needsKey: boolean }
> = {
  openai: {
    defaultBaseUrl: 'https://api.openai.com/v1',
    sampleModel: 'gpt-4o',
    needsKey: true,
  },
  anthropic: {
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    sampleModel: 'claude-opus-4-8',
    needsKey: true,
  },
  ollama: {
    defaultBaseUrl: 'http://127.0.0.1:11434/v1',
    sampleModel: 'qwen3:14b',
    needsKey: false,
  },
  custom: {
    defaultBaseUrl: '',
    sampleModel: '',
    needsKey: false,
  },
};

/** Az AI-feladatok, amikhez külön modell rendelhető (mind a `runStructured`-ön megy). */
export type AiTask = 'assistant' | 'autoEdit' | 'captionStudio' | 'hooks' | 'thumbHeadlines';

/** A választható feladatok sorrendje (a profil UI ezt listázza). */
export const AI_TASKS: AiTask[] = [
  'assistant',
  'autoEdit',
  'captionStudio',
  'hooks',
  'thumbHeadlines',
];

function currentUserId(): string {
  const id = useAuth.getState().user?.id;
  if (!id) {
    throw new Error('Nincs bejelentkezett felhasználó.');
  }
  return id;
}

interface Row {
  id: string;
  label: string;
  provider: string;
  base_url: string | null;
  model: string;
  api_key: string | null;
  is_default: boolean;
}

function toProvider(row: Row): AiProvider {
  const kind = (['openai', 'anthropic', 'ollama', 'custom'] as const).includes(
    row.provider as AiProviderKind,
  )
    ? (row.provider as AiProviderKind)
    : 'custom';
  return {
    id: row.id,
    label: row.label,
    provider: kind,
    baseUrl: row.base_url ?? '',
    model: row.model,
    apiKey: row.api_key ?? '',
    isDefault: row.is_default,
  };
}

/** A user összes AI-providere (alapértelmezett elöl, majd név szerint). */
export async function listAiProviders(): Promise<AiProvider[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('user_ai_providers')
    .select('id, label, provider, base_url, model, api_key, is_default')
    .order('is_default', { ascending: false })
    .order('label', { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  return (data as Row[]).map(toProvider);
}

/** Új provider. Ha ez az első, automatikusan alapértelmezett lesz. */
export async function createAiProvider(input: AiProviderInput): Promise<AiProvider> {
  const supabase = requireSupabase();
  const uid = currentUserId();
  const { count } = await supabase
    .from('user_ai_providers')
    .select('id', { count: 'exact', head: true });
  const { data, error } = await supabase
    .from('user_ai_providers')
    .insert({
      user_id: uid,
      label: input.label.trim(),
      provider: input.provider,
      base_url: input.baseUrl.trim() || null,
      model: input.model.trim(),
      api_key: input.apiKey.trim() || null,
      is_default: (count ?? 0) === 0, // az első provider legyen az alapértelmezett
    })
    .select('id, label, provider, base_url, model, api_key, is_default')
    .single();
  if (error) {
    throw new Error(error.message);
  }
  return toProvider(data as Row);
}

/** Meglévő provider módosítása. */
export async function updateAiProvider(
  id: string,
  patch: AiProviderInput,
): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('user_ai_providers')
    .update({
      label: patch.label.trim(),
      provider: patch.provider,
      base_url: patch.baseUrl.trim() || null,
      model: patch.model.trim(),
      api_key: patch.apiKey.trim() || null,
    })
    .eq('id', id);
  if (error) {
    throw new Error(error.message);
  }
}

/** Provider törlése. */
export async function deleteAiProvider(id: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('user_ai_providers').delete().eq('id', id);
  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Alapértelmezett provider beállítása. Előbb a többit nullázzuk (a `where
 * is_default` parciális unique index miatt egyszerre csak egy lehet igaz),
 * majd a kiválasztottat állítjuk.
 */
export async function setDefaultAiProvider(id: string): Promise<void> {
  const supabase = requireSupabase();
  const uid = currentUserId();
  const cleared = await supabase
    .from('user_ai_providers')
    .update({ is_default: false })
    .eq('user_id', uid)
    .neq('id', id);
  if (cleared.error) {
    throw new Error(cleared.error.message);
  }
  const { error } = await supabase
    .from('user_ai_providers')
    .update({ is_default: true })
    .eq('id', id);
  if (error) {
    throw new Error(error.message);
  }
}

/** A user alapértelmezett providere (vagy null, ha nincs). */
export async function getDefaultAiProvider(): Promise<AiProvider | null> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('user_ai_providers')
    .select('id, label, provider, base_url, model, api_key, is_default')
    .eq('is_default', true)
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data ? toProvider(data as Row) : null;
}

/** A workernek küldött AI-config alakja (per kérés, BYOK). */
export interface AiRequestConfig {
  provider: AiProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string;
}

/** Provider → a worker-hívás configja (üres endpoint = a fajta alapértelmezettje). */
function toConfig(p: AiProvider): AiRequestConfig | undefined {
  if (!p.model.trim()) {
    return undefined;
  }
  return {
    provider: p.provider,
    baseUrl: p.baseUrl.trim() || AI_PROVIDER_KINDS[p.provider].defaultBaseUrl,
    model: p.model.trim(),
    apiKey: p.apiKey.trim(),
  };
}

/**
 * Az aktuális user alapértelmezett providere a worker-hívásba illesztve, vagy
 * `undefined` — akkor a worker a saját (env) AI-jára esik vissza. Sosem dob:
 * config/hálózat hiba esetén is `undefined` (az AI-funkciók így nem törnek el).
 */
export async function aiConfigForRequest(): Promise<AiRequestConfig | undefined> {
  if (!hasSupabaseConfig()) {
    return undefined;
  }
  try {
    const p = await getDefaultAiProvider();
    return p ? toConfig(p) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Egy KONKRÉT feladathoz rendelt modell configja. Feloldási sorrend:
 *   1. a feladathoz kézzel rendelt provider (user_ai_task_providers),
 *   2. az alapértelmezett provider (is_default),
 *   3. `undefined` → a worker env-AI-ja.
 * Sosem dob (az AI-funkciók hibatűrők maradnak).
 */
export async function aiConfigForTask(task: AiTask): Promise<AiRequestConfig | undefined> {
  if (!hasSupabaseConfig()) {
    return undefined;
  }
  try {
    const supabase = requireSupabase();
    // egy lekérés: a feladathoz kötött provider beágyazva (RLS mindkét táblán saját)
    const { data } = await supabase
      .from('user_ai_task_providers')
      .select('provider:user_ai_providers(id, label, provider, base_url, model, api_key, is_default)')
      .eq('task', task)
      .maybeSingle();
    const embedded = (data as { provider?: Row | Row[] } | null)?.provider;
    const row = Array.isArray(embedded) ? embedded[0] : embedded;
    if (row) {
      return toConfig(toProvider(row));
    }
    // nincs feladat-hozzárendelés → alapértelmezett provider
    return aiConfigForRequest();
  } catch {
    return undefined;
  }
}

/** Feladat → provider-id leképezés (a profil UI-hoz). Hozzárendelés nélküli feladat hiányzik. */
export async function listTaskAssignments(): Promise<Partial<Record<AiTask, string>>> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('user_ai_task_providers')
    .select('task, provider_id');
  if (error) {
    throw new Error(error.message);
  }
  const map: Partial<Record<AiTask, string>> = {};
  for (const r of (data ?? []) as { task: AiTask; provider_id: string }[]) {
    map[r.task] = r.provider_id;
  }
  return map;
}

/** Feladat → modell beállítása; `null` = vissza az alapértelmezettre (sor törlése). */
export async function setTaskAssignment(
  task: AiTask,
  providerId: string | null,
): Promise<void> {
  const supabase = requireSupabase();
  if (providerId == null) {
    const { error } = await supabase
      .from('user_ai_task_providers')
      .delete()
      .eq('task', task);
    if (error) {
      throw new Error(error.message);
    }
    return;
  }
  const { error } = await supabase
    .from('user_ai_task_providers')
    .upsert(
      { user_id: currentUserId(), task, provider_id: providerId },
      { onConflict: 'user_id,task' },
    );
  if (error) {
    throw new Error(error.message);
  }
}
