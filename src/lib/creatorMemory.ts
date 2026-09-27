import { makeId } from '@/lib/id';
import { normalizeText } from '@/lib/visionIndex';
import type { Project, ProjectKind, TextClip } from '@/types/project';

/**
 * 🧠 Creator Memory (PM4 — MASTER §12) — a creator perzisztens AI-kontextus-
 * rétege: „ez az én YouTube-stílusom", „mindig sárga feliratot használok",
 * „a kedvenc LUT-om teal-orange", „ezt a kamerát használom". Minden stúdió
 * AI-ja EZT olvassa (a `buildAiContext` Memory-rétegébe fűzve).
 *
 * Az app DNS-e szerint ez ESZKÖZÖN futó, INGYENES infrastruktúra (nincs Pro-
 * gate, nincs felhő-hívás) — a katalógusba nem kerül új sor. A modul TISZTA:
 * minden művelet immutábilis reducer (a command-bus filozófiáját tükrözi a
 * saját állapotán), így önmagában tesztelhető és expo-mentes.
 */

/** A tudás-kategóriák (a label i18n: `lib.creatorMemory.category.<id>`). */
export type MemoryCategory =
  | 'style' // vizuális/hangzásbeli stílus („ez az én YouTube-stílusom")
  | 'caption' // felirat-preferencia (szín/font/pozíció)
  | 'voice' // kedvenc hangszínek / TTS-hang
  | 'music' // saját zenék / kedvenc műfaj / tempó
  | 'color' // kedvenc LUT / paletta / grade
  | 'gear' // felszerelés (kamera / mikrofon / szoftver)
  | 'brand' // brand-szabály (logó / szín / hangnem)
  | 'workflow' // preferált munkafolyamat
  | 'terminology' // terminológia (író: nevek / szakszavak)
  | 'fact'; // általános tény

export const MEMORY_CATEGORIES: MemoryCategory[] = [
  'style',
  'caption',
  'voice',
  'music',
  'color',
  'gear',
  'brand',
  'workflow',
  'terminology',
  'fact',
];

export interface MemoryFact {
  id: string;
  category: MemoryCategory;
  /** rövid, ember- ÉS AI-olvasható tény („Mindig sárga, vastag feliratot használok"). */
  text: string;
  /** opcionális gépi kulcs a dedup/megerősítéshez (pl. `caption:color`, `gear:camera`). */
  key?: string;
  /** mely stúdióra vonatkozik; üres/hiányzó = MINDEN stúdió. */
  scopes?: ProjectKind[];
  /** 0–1 fontosság — a kontextusba a legfontosabbak kerülnek elöl. */
  weight: number;
  /** hányszor erősítette meg a viselkedés (auto-tanulás). */
  hits: number;
  /** kézzel rögzített tény — mindig bekerül a kontextusba, súlytól függetlenül. */
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreatorMemory {
  facts: MemoryFact[];
  updatedAt: string;
}

/** Új tény felvételéhez szükséges minimális mezők. */
export interface MemoryInput {
  category: MemoryCategory;
  text: string;
  key?: string;
  scopes?: ProjectKind[];
  weight?: number;
  pinned?: boolean;
}

const DEFAULT_WEIGHT = 0.5;
const MAX_WEIGHT = 1;
/** a kontextusba/visszaadásba kerülő tények alap-plafonja. */
export const MEMORY_CONTEXT_LIMIT = 12;

export function emptyMemory(now = new Date().toISOString()): CreatorMemory {
  return { facts: [], updatedAt: now };
}

const clampWeight = (w: number): number => Math.max(0, Math.min(MAX_WEIGHT, w));

/** dedup-kulcs: az explicit `key`, különben a normalizált szöveg. */
function factKey(f: Pick<MemoryFact, 'key' | 'text'>): string {
  return f.key ? `k:${f.key}` : `t:${normalizeText(f.text)}`;
}

/**
 * Tény hozzáadása. Ha már van AZONOS kulcsú (vagy azonos normalizált szövegű)
 * tény, azt FRISSÍTI (szöveg/súly/scope), a `hits`-et növeli és a súlyt emeli —
 * így az ismételt megerősítés nem duplikál, hanem erősít.
 */
export function addFact(
  mem: CreatorMemory,
  input: MemoryInput,
  now = new Date().toISOString()
): CreatorMemory {
  const text = input.text.trim();
  if (!text) {
    return mem;
  }
  const key = factKey({ key: input.key, text });
  const existing = mem.facts.find((f) => factKey(f) === key);
  if (existing) {
    const merged: MemoryFact = {
      ...existing,
      text,
      category: input.category,
      scopes: input.scopes ?? existing.scopes,
      hits: existing.hits + 1,
      weight: clampWeight(Math.max(existing.weight, input.weight ?? existing.weight) + 0.1),
      pinned: input.pinned ?? existing.pinned,
      updatedAt: now,
    };
    return {
      facts: mem.facts.map((f) => (f.id === existing.id ? merged : f)),
      updatedAt: now,
    };
  }
  const fact: MemoryFact = {
    id: makeId('mem'),
    category: input.category,
    text,
    ...(input.key ? { key: input.key } : {}),
    ...(input.scopes ? { scopes: input.scopes } : {}),
    weight: clampWeight(input.weight ?? DEFAULT_WEIGHT),
    hits: 1,
    pinned: input.pinned ?? false,
    createdAt: now,
    updatedAt: now,
  };
  return { facts: [...mem.facts, fact], updatedAt: now };
}

/** Egy tény mezőinek módosítása (a kliens szerkesztőjéhez). */
export function updateFact(
  mem: CreatorMemory,
  id: string,
  patch: Partial<Pick<MemoryFact, 'text' | 'category' | 'scopes' | 'weight' | 'pinned'>>,
  now = new Date().toISOString()
): CreatorMemory {
  let changed = false;
  const facts = mem.facts.map((f) => {
    if (f.id !== id) {
      return f;
    }
    changed = true;
    return {
      ...f,
      ...patch,
      ...(patch.weight !== undefined ? { weight: clampWeight(patch.weight) } : {}),
      updatedAt: now,
    };
  });
  return changed ? { facts, updatedAt: now } : mem;
}

export function removeFact(mem: CreatorMemory, id: string, now = new Date().toISOString()): CreatorMemory {
  const facts = mem.facts.filter((f) => f.id !== id);
  return facts.length === mem.facts.length ? mem : { facts, updatedAt: now };
}

export function pinFact(
  mem: CreatorMemory,
  id: string,
  pinned: boolean,
  now = new Date().toISOString()
): CreatorMemory {
  return updateFact(mem, id, { pinned }, now);
}

/**
 * Auto-tanulás: egy kulcs (vagy szöveg) megerősítése a viselkedésből — ha van
 * ilyen tény, növeli a `hits`-et és a súlyt; ha nincs, nem csinál semmit.
 * (Új tényt az `addFact` vesz fel.)
 */
export function reinforceFact(
  mem: CreatorMemory,
  keyOrText: string,
  now = new Date().toISOString()
): CreatorMemory {
  const target = `k:${keyOrText}`;
  const targetText = `t:${normalizeText(keyOrText)}`;
  let changed = false;
  const facts = mem.facts.map((f) => {
    const k = factKey(f);
    if (k !== target && k !== targetText) {
      return f;
    }
    changed = true;
    return { ...f, hits: f.hits + 1, weight: clampWeight(f.weight + 0.1), updatedAt: now };
  });
  return changed ? { facts, updatedAt: now } : mem;
}

/** Igaz, ha a tény az adott stúdióra vonatkozik (scope hiánya = minden stúdió). */
function inScope(f: MemoryFact, scope?: ProjectKind): boolean {
  if (!scope || !f.scopes || f.scopes.length === 0) {
    return true;
  }
  return f.scopes.includes(scope);
}

/**
 * Rangsorolt tények egy stúdióhoz: a rögzítettek (pinned) előre, majd súly ×
 * (1 + hit-bónusz), végül a frissesség dönt. A `scope` szűri a stúdió-specifikus
 * tényeket (a globálisak mindig bejönnek).
 */
export function rankedFacts(
  mem: CreatorMemory,
  scope?: ProjectKind,
  limit = MEMORY_CONTEXT_LIMIT
): MemoryFact[] {
  const scored = mem.facts
    .filter((f) => inScope(f, scope))
    .map((f) => ({ f, s: f.weight * (1 + Math.min(f.hits, 10) * 0.05) }));
  scored.sort((a, b) => {
    if (a.f.pinned !== b.f.pinned) {
      return a.f.pinned ? -1 : 1;
    }
    if (b.s !== a.s) {
      return b.s - a.s;
    }
    return b.f.updatedAt.localeCompare(a.f.updatedAt);
  });
  return scored.slice(0, limit).map((x) => x.f);
}

/**
 * Kompakt, kategóriánként csoportosított kontextus-objektum a `buildAiContext`
 * Memory-rétegébe. Csak a rangsor tetejét adja vissza, hogy ne hízlalja a
 * promptot. Üres memóriánál `null` (a hívó ekkor ki is hagyhatja a mezőt).
 */
export function memoryContext(
  mem: CreatorMemory,
  scope?: ProjectKind,
  limit = MEMORY_CONTEXT_LIMIT
): Partial<Record<MemoryCategory, string[]>> | null {
  const facts = rankedFacts(mem, scope, limit);
  if (facts.length === 0) {
    return null;
  }
  const out: Partial<Record<MemoryCategory, string[]>> = {};
  for (const f of facts) {
    (out[f.category] ??= []).push(f.text);
  }
  return out;
}

/** Ember-olvasható sorok (Előzmények-modal / debug): „🎨 style: …". */
export function memoryContextLines(mem: CreatorMemory, scope?: ProjectKind, limit = MEMORY_CONTEXT_LIMIT): string[] {
  return rankedFacts(mem, scope, limit).map((f) => `${f.category}: ${f.text}`);
}

/**
 * Két memória egyesítése (pl. felhő + helyi). A kulcs-egyezőnél az UTÓBB
 * frissített tény nyer, a `hits` összeadódik, a súly a nagyobbik.
 */
export function mergeMemory(a: CreatorMemory, b: CreatorMemory, now = new Date().toISOString()): CreatorMemory {
  const byKey = new Map<string, MemoryFact>();
  for (const f of [...a.facts, ...b.facts]) {
    const k = factKey(f);
    const prev = byKey.get(k);
    if (!prev) {
      byKey.set(k, f);
      continue;
    }
    const newer = f.updatedAt >= prev.updatedAt ? f : prev;
    byKey.set(k, {
      ...newer,
      hits: prev.hits + f.hits,
      weight: clampWeight(Math.max(prev.weight, f.weight)),
      pinned: prev.pinned || f.pinned,
    });
  }
  return { facts: [...byKey.values()], updatedAt: now };
}

// ── Auto-tanulás projektből ────────────────────────────────────────────────

/** leggyakoribb érték egy mezőben (a klipeken végig) — a determinisztikus tanuláshoz. */
function dominant<T>(values: (T | undefined | null)[]): T | null {
  const counts = new Map<T, number>();
  for (const v of values) {
    if (v === undefined || v === null || v === '') {
      continue;
    }
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: T | null = null;
  let bestN = 0;
  for (const [v, n] of counts) {
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

/**
 * Determinisztikus jelek kinyerése egy elkészült projektből → memória-tények
 * (a „AI LEARNS" retention-loop magja). A jeleknek STABIL kulcsuk van, így az
 * ismételt megfigyelés MEGERŐSÍT, nem duplikál. Csak a magabiztos jeleket veszi
 * fel (pl. van legalább egy felirat-klip). A `kind` scope- olja a tényeket.
 */
export function observeProject(
  mem: CreatorMemory,
  project: Project,
  now = new Date().toISOString()
): CreatorMemory {
  const scope: ProjectKind = project.kind ?? 'video';
  let next = mem;

  // képarány-preferencia
  next = addFact(
    next,
    {
      category: 'style',
      key: `aspect:${scope}`,
      scopes: [scope],
      text: `Preferált képarány: ${project.aspectRatio}`,
      weight: 0.4,
    },
    now
  );

  const texts = project.tracks
    .flatMap((t) => t.clips)
    .filter((c): c is TextClip => c.kind === 'text');
  const captionClips = project.tracks.find((t) => t.type === 'captions')?.clips ?? [];
  const captionTexts = captionClips.filter((c): c is TextClip => c.kind === 'text');

  const font = dominant(texts.map((c) => c.fontFamily));
  if (font) {
    next = addFact(
      next,
      { category: 'style', key: 'font', scopes: [scope], text: `Kedvenc betűtípus: ${font}`, weight: 0.5 },
      now
    );
  }

  if (captionTexts.length > 0) {
    const color = dominant(captionTexts.map((c) => c.color));
    if (color) {
      next = addFact(
        next,
        {
          category: 'caption',
          key: 'caption:color',
          scopes: [scope],
          text: `Felirat-szín: ${color}`,
          weight: 0.5,
        },
        now
      );
    }
    next = addFact(
      next,
      {
        category: 'caption',
        key: 'caption:used',
        scopes: [scope],
        text: 'Rendszeresen használ égetett feliratot',
        weight: 0.4,
      },
      now
    );
  }

  return next;
}
