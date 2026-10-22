import type { AiTask } from '@/lib/aiProviders'; // type-only → nem húzza be a supabase-réteget
import type { AiModality, DeviceCaps } from '@/lib/aiRouting';
import type { ModelManifestEntry } from '@/lib/modelRegistry';

/**
 * 🏭 Gyári AI-modell-katalógus — tiszta mag (local-ai 5.1/5.2).
 *
 * A Profil „AI-Modellek" felülete ezt UNIÓZZA a user BYOK-providereivel: a
 * gyári modellek user-setup nélkül ott vannak, letölthetők (device) vagy eleve
 * aktívak (worker/system). Minden elem CÉL-KÖTÖTT: a `modalities` (amire képes)
 * + `tasks` (amire használható) kötést a feloldók HÍVÁSKOR ellenőrzik
 * (`modelAllowedForTask`), nem csak a UI. A letöltés/smoke-test állapota a
 * `modelRegistryClient`-ben él; ez a mag determinista státuszt számol belőle.
 *
 * ⚠️ A device-motorok (whisper.rn / ExecuTorch) natív dependenciák — amíg nincsenek
 * a buildben, a `BUILD_ENGINES` flagjük false, és a katalógus-elem státusza
 * `engine_missing` (a kártya ezt őszintén mutatja: „új dev-build kell").
 */

export type CatalogWhere = 'device' | 'system' | 'worker';
export type CatalogEngine = 'whisper-rn' | 'executorch' | 'system' | 'worker';

export interface CatalogEntry {
  id: string;
  /** emberi címke a kártyára (a cél-leírás i18n: `profile.catalog_<id>`) */
  label: string;
  emoji: string;
  where: CatalogWhere;
  engine: CatalogEngine;
  /** amire KÉPES (routing-tengely) — a deviceCaps ebből áll össze */
  modalities: AiModality[];
  /** amire HASZNÁLHATÓ a profil feladat-mátrixában (üres = nem LLM-feladat) */
  tasks: AiTask[];
  /** letölthető modell manifesztje (csak device-elemeknél) */
  manifest?: ModelManifestEntry;
  /** a motorral együtt érkező beépített képesség (pl. Silero VAD) — nincs letöltés */
  bundled?: true;
  /** eszköz-gate: minimális RAM GB (A-tier modellekhez); hiányzó = nincs gate */
  minRamGb?: number;
}

/** mind a 6 profil-feladat (a worker env-AI mindet viszi) */
const ALL_TASKS: AiTask[] = [
  'assistant',
  'autoEdit',
  'captionStudio',
  'hooks',
  'thumbHeadlines',
  'storyStructure',
];

export const MODEL_CATALOG: CatalogEntry[] = [
  {
    id: 'remix-assistant',
    label: 'ReMix Assistant',
    emoji: '🤖',
    where: 'worker',
    engine: 'worker',
    modalities: ['text', 'smallText', 'vision'],
    tasks: ALL_TASKS,
  },
  {
    id: 'whisper-tiny-q8',
    label: 'Whisper tiny',
    emoji: '🎙️',
    where: 'device',
    engine: 'whisper-rn',
    modalities: ['transcribe'],
    tasks: [],
    manifest: {
      id: 'whisper-tiny-q8',
      version: '1.0.0',
      url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny-q8_0.bin',
      sha256: 'c2085835d3f50733e2ff6e4b41ae8a2b8d8110461e18821b09a15c40c42d1cca',
      sizeBytes: 45_600_000, // ~43,5 MB
      kind: 'whisper',
      modalities: ['transcribe'],
    },
  },
  {
    id: 'whisper-base-q5',
    label: 'Whisper base',
    emoji: '🎙️',
    where: 'device',
    engine: 'whisper-rn',
    modalities: ['transcribe'],
    tasks: [],
    manifest: {
      id: 'whisper-base-q5',
      version: '1.0.0',
      url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin',
      sha256: '422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898',
      sizeBytes: 62_600_000, // ~59,7 MB
      kind: 'whisper',
      modalities: ['transcribe'],
    },
  },
  {
    // a Silero VAD a whisper.rn-nel érkezik (nem külön letöltés) — csend/beszéd szegmensek
    id: 'silero-vad',
    label: 'Silero VAD',
    emoji: '🔇',
    where: 'device',
    engine: 'whisper-rn',
    modalities: ['transcribe'],
    tasks: [],
    bundled: true,
  },
  {
    // Fázis B: lokális médiakeresés embedding-encoderrel (manifest akkor kerül be)
    id: 'embed-encoder',
    label: 'Kereső-encoder',
    emoji: '🔎',
    where: 'device',
    engine: 'executorch',
    modalities: ['embed'],
    tasks: [],
  },
  {
    id: 'os-speech',
    label: 'Rendszer-beszédfelismerő',
    emoji: '🗣️',
    where: 'system',
    engine: 'system',
    modalities: ['transcribe'],
    tasks: [],
  },
  {
    id: 'os-segment',
    label: 'Rendszer-szegmentáló',
    emoji: '✂️',
    where: 'system',
    engine: 'system',
    modalities: ['vision'],
    tasks: [],
  },
  {
    // Fázis D: on-device SLM (intent→parancs, caption-tisztítás) — csak A-tier
    id: 'slm-small',
    label: 'Helyi asszisztens (SLM)',
    emoji: '🧠',
    where: 'device',
    engine: 'executorch',
    modalities: ['smallText'],
    tasks: ['assistant', 'captionStudio'],
    minRamGb: 8,
  },
];

/** Katalógus-elem id szerint. */
export function catalogEntry(id: string): CatalogEntry | undefined {
  return MODEL_CATALOG.find((e) => e.id === id);
}

/**
 * 🔒 Cél-kötés kapu (local-ai 5.2): az elem CSAK a deklarált feladataira
 * fogható. A feloldó (engine-választó / task-routing) híváskor ezt kérdezi —
 * kézzel átírt hozzárendelés is itt bukik el, nem a UI-n.
 */
export function modelAllowedForTask(entry: CatalogEntry, task: AiTask): boolean {
  return entry.tasks.includes(task);
}

/** Egy modalitásra képes katalógus-elemek (engine-választáshoz). */
export function catalogForModality(modality: AiModality): CatalogEntry[] {
  return MODEL_CATALOG.filter((e) => e.modalities.includes(modality));
}

/** Egy feladatra használható katalógus-elemek (a feladat-mátrixhoz). */
export function catalogForTask(task: AiTask): CatalogEntry[] {
  return MODEL_CATALOG.filter((e) => modelAllowedForTask(e, task));
}

/**
 * Milyen motorok vannak EBBEN a buildben. A natív AI-dependenciák (whisper.rn,
 * react-native-executorch) bekötésekor kell true-ra váltani — addig a katalógus
 * őszintén `engine_missing`-et mutat. A `system` akkor lesz true, ha a platform-API
 * wrapper (Vision/ML Kit/SpeechAnalyzer híd) bekerül.
 */
export const BUILD_ENGINES: Readonly<Partial<Record<CatalogEngine, boolean>>> = {
  worker: true,
  system: false,
  'whisper-rn': false,
  executorch: false,
};

export type CatalogAvailability =
  /** használatra kész (worker / rendszer-képesség) */
  | 'active'
  /** letölthető, még nincs az eszközön */
  | 'downloadable'
  /** letöltve, de a használat-előtti smoke-test még nem futott le */
  | 'downloaded'
  /** letöltve + smoke-test PASS → használható */
  | 'validated'
  /** smoke-test FAIL → nem választható (újratölthető) */
  | 'failed'
  /** a natív motor nincs ebben a buildben (új dev-build kell) */
  | 'engine_missing'
  /** az eszköz nem éri el a minimum RAM-ot (A-tier gate) */
  | 'gated'
  /** tervezett elem, még nincs letölthető manifest */
  | 'planned';

export interface CatalogRuntime {
  /** mely motorok vannak jelen (alap: BUILD_ENGINES) */
  engines?: Partial<Record<CatalogEngine, boolean>>;
  /** letöltött modell-id-k */
  downloaded?: readonly string[];
  /** használat-előtti smoke-test eredmények (local-ai 5.3) */
  smoke?: Readonly<Record<string, 'pass' | 'fail'>>;
  /** az eszköz RAM-ja GB-ban (a `gated` döntéshez); hiányzó = nincs gate-ellenőrzés */
  deviceRamGb?: number;
}

/** Determinista státusz egy katalógus-elemre a futásidejű állapotból. */
export function catalogAvailability(
  entry: CatalogEntry,
  rt: CatalogRuntime = {},
): CatalogAvailability {
  const engines = rt.engines ?? BUILD_ENGINES;
  if (entry.where === 'worker') {
    return 'active';
  }
  if (!engines[entry.engine]) {
    return 'engine_missing';
  }
  if (entry.where === 'system') {
    return 'active';
  }
  // device-elem, motorral
  if (
    typeof entry.minRamGb === 'number' &&
    typeof rt.deviceRamGb === 'number' &&
    rt.deviceRamGb < entry.minRamGb
  ) {
    return 'gated';
  }
  if (!entry.manifest) {
    // beépített (motorral érkező) képesség aktív; manifest nélküli tervezett elem nem
    return entry.bundled ? 'active' : 'planned';
  }
  if (rt.smoke?.[entry.id] === 'fail') {
    return 'failed';
  }
  if (rt.downloaded?.includes(entry.id)) {
    return rt.smoke?.[entry.id] === 'pass' ? 'validated' : 'downloaded';
  }
  return 'downloadable';
}

/** Használható-e az elem MOST (BP-13: vizsga/smoke nélkül nincs használat). */
export function catalogUsable(entry: CatalogEntry, rt: CatalogRuntime = {}): boolean {
  const a = catalogAvailability(entry, rt);
  return a === 'active' || a === 'validated';
}

/**
 * Az eszköz lokál AI-képességei a katalógus-állapotból — ez megy a
 * `routeAiTask({ device })` bemenetébe (06.1). Csak a HASZNÁLHATÓ (active/
 * validated) DEVICE/SYSTEM elemek modalitásai számítanak: a letöltött, de
 * smoke-teszteletlen modell még nem képesség.
 */
export function deviceCapsFromCatalog(rt: CatalogRuntime = {}): DeviceCaps {
  const modalities = new Set<AiModality>();
  for (const entry of MODEL_CATALOG) {
    if (entry.where !== 'worker' && catalogUsable(entry, rt)) {
      for (const m of entry.modalities) {
        modalities.add(m);
      }
    }
  }
  return { modalities: [...modalities] };
}
