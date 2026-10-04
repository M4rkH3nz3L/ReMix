/**
 * Capability-katalógus — EGY hely, ami kimondja, hogy egy művelet HOL fut és
 * KELL-e hozzá Pro-előfizetés.
 *
 * ÜZLETI MODELL (a #1 termék-blokkoló feloldása):
 *   • KÉZI szerkesztés + ALAP export = mindig INGYEN, az ESZKÖZÖN fut → soha
 *     nem kell szerver, valós felhasználónál is működik.
 *   • Az AI-réteg és a felhő-HD render a mi FIZETŐS felhő-workereinken megy —
 *     ezek Pro-előfizetést igényelnek (`pro: true`).
 *
 * A `where` mezőt a backend-router (`@/lib/backend`) és a natív renderelő
 * (`@/lib/nativeRender`) olvassa; a `pro` mezőt a paywall-gate.
 */

import { t as tr } from 'i18next';

import { isPaidTier, tierMeetsMin, type Tier } from '@/lib/tiers';

export type Where = 'local' | 'cloud';

export type CapabilityId =
  // ── ESZKÖZÖN, INGYEN ────────────────────────────────────────────────
  | 'localRender' // alap MP4 export a telefonon (natív AVFoundation/MediaCodec)
  | 'screenRecord' // 🎮 képernyő-/game-felvétel (ReplayKit / MediaProjection) — eszközön, ingyen
  // ── FELHŐ-WORKER, PRO ───────────────────────────────────────────────
  | 'cloudRender' // felhő HD/4K render (queue + S3), gyorsabb, nagyobb felbontás
  | 'autoCaption' // Whisper: beszéd → felirat
  | 'urlImport' // import linkből (YouTube / TikTok / …)
  | 'autoEdit' // AI Auto-Edit / cutplan / hook-ok
  | 'storyAnalyze' // AI story-struktúra (Hook→Context→Value→CTA felismerés)
  | 'pacingAnalyze' // AI tempó-elemzés (beszéd/csend/vágás-jelek → lassú szakaszok)
  | 'qualityScan' // felvétel-minőség ellenőrzés (homályos / alul-túlexponált kockák)
  | 'cloudSync' // projekt felhő-mentés/visszaállítás (cloud-tárhely)
  | 'collab' // projekt-kollaboráció: tagok meghívása + szerepkörök (megosztott felhő-projekt)
  | 'bgRemove' // háttér-eltávolítás
  | 'depth3d' // mélység / 3D / parallax
  | 'faceTools' // arc-követés / retusálás
  | 'reframe' // AI újrakeretezés (vízszintes → álló)
  | 'objectTrack' // 🎯 általános objektum-követés (NCC-tracker a workeren) — szöveg/matrica/kép/3D/maszk/blur követi a kijelölt objektumot
  | 'upscale' // felskálázás
  | 'skyReplace' // ég-csere
  | 'colorAi' // AI szín / auto-grade
  | 'tts' // szöveg → beszéd / Voice Studio
  | 'writeAssist' // ✍️ Writer Studio AI: rewrite/tone/summarize/expand/translate/outline
  | 'pitchCorrect' // 🎤 Vocal Studio: pitch-correction / harmónia-render (Rubber Band / world a workeren)
  // ── 🤖 S-GENAI generatív média (mind cloud + Pro, provider-adapterrel) ──────
  | 'genImage' // text→kép / kép→kép / inpaint / outpaint
  | 'genVideo' // text/kép→videó
  | 'genMusic' // generatív zene
  | 'voiceClone' // hang-klón (a TTS bővítése; hozzájárulással)
  | 'aiAvatar' // AI-avatar / digital-human
  | 'soundLibrary'; // worker hang-könyvtár (ingyenes felhő-funkció)

/**
 * A `where`/`minTier` kombináció TÍPUS-SZINTEN kódolja a szigorú üzleti szabályt:
 * ami az ESZKÖZÖN fut (`where: 'local'`), az KÖTELEZŐEN ingyenes (`minTier: 'free'`)
 * — on-device funkciót soha nem kapuzunk fizetős szint mögé. Felhő-funkció (`'cloud'`)
 * bármely szintet kérhet (`free` is — pl. `soundLibrary`, `cloudSync`).
 *
 * Következmény: egy `{ where: 'local', minTier: 'pro' }` sor FORDÍTÁSI HIBÁT ad, így
 * a szabály minden `tsc --noEmit` futásnál automatikusan auditálva van.
 *
 * Az audit §2.1: a kapuzás `capability.minTier` ellen megy (Free/Basic/Pro/Ultra),
 * nem `if pro`. A mai (free/pro) viselkedés változatlan — a jelenlegi Pro-képességek
 * `minTier: 'pro'`-k; a `basic`/`ultra` besorolás additív (a billing-bekötés hátra, §2.4).
 */
type CapabilityMeta =
  | { where: 'local'; minTier: 'free'; label: string }
  | { where: 'cloud'; minTier: Tier; label: string };

export const CAPABILITIES: Record<CapabilityId, CapabilityMeta> = {
  localRender: { where: 'local', minTier: 'free', label: 'lib.capabilities.label.localRender' },
  screenRecord: { where: 'local', minTier: 'free', label: 'lib.capabilities.label.screenRecord' },

  cloudRender: { where: 'cloud', minTier: 'pro', label: 'lib.capabilities.label.cloudRender' },
  autoCaption: { where: 'cloud', minTier: 'pro', label: 'lib.capabilities.label.autoCaption' },
  urlImport: { where: 'cloud', minTier: 'pro', label: 'lib.capabilities.label.urlImport' },
  autoEdit: { where: 'cloud', minTier: 'pro', label: 'lib.capabilities.label.autoEdit' },
  storyAnalyze: { where: 'cloud', minTier: 'pro', label: 'lib.capabilities.label.storyAnalyze' },
  pacingAnalyze: { where: 'cloud', minTier: 'pro', label: 'lib.capabilities.label.pacingAnalyze' },
  qualityScan: { where: 'cloud', minTier: 'pro', label: 'lib.capabilities.label.qualityScan' },
  // 🗄️ HIBRID adat-biztonság: a projekt-TERV (kis JSON, média nélkül) DB-mentése és
  // a kollaboráció INGYENES — hogy a projektek SOHA ne vesszenek el (userhez kötve),
  // és bárki megoszthasson/meghívhasson. A Pro-érték a NEHÉZ felhő marad: média-
  // felhősync, HD/felhő-render, AI. (Lásd MONEY.md — ezt frissíteni kell.)
  cloudSync: { where: 'cloud', minTier: 'free', label: 'lib.capabilities.label.cloudSync' },
  collab: { where: 'cloud', minTier: 'free', label: 'lib.capabilities.label.collab' },
  bgRemove: { where: 'cloud', minTier: 'pro', label: 'lib.capabilities.label.bgRemove' },
  depth3d: { where: 'cloud', minTier: 'pro', label: 'lib.capabilities.label.depth3d' },
  faceTools: { where: 'cloud', minTier: 'pro', label: 'lib.capabilities.label.faceTools' },
  reframe: { where: 'cloud', minTier: 'pro', label: 'lib.capabilities.label.reframe' },
  objectTrack: { where: 'cloud', minTier: 'pro', label: 'lib.capabilities.label.objectTrack' },
  upscale: { where: 'cloud', minTier: 'pro', label: 'lib.capabilities.label.upscale' },
  skyReplace: { where: 'cloud', minTier: 'pro', label: 'lib.capabilities.label.skyReplace' },
  colorAi: { where: 'cloud', minTier: 'pro', label: 'lib.capabilities.label.colorAi' },
  tts: { where: 'cloud', minTier: 'pro', label: 'lib.capabilities.label.tts' },
  writeAssist: { where: 'cloud', minTier: 'pro', label: 'lib.capabilities.label.writeAssist' },
  pitchCorrect: { where: 'cloud', minTier: 'pro', label: 'lib.capabilities.label.pitchCorrect' },
  genImage: { where: 'cloud', minTier: 'pro', label: 'lib.capabilities.label.genImage' },
  genVideo: { where: 'cloud', minTier: 'pro', label: 'lib.capabilities.label.genVideo' },
  genMusic: { where: 'cloud', minTier: 'pro', label: 'lib.capabilities.label.genMusic' },
  voiceClone: { where: 'cloud', minTier: 'pro', label: 'lib.capabilities.label.voiceClone' },
  aiAvatar: { where: 'cloud', minTier: 'pro', label: 'lib.capabilities.label.aiAvatar' },
  // a hang-könyvtár felhőből jön, de minden felhasználónak jár
  soundLibrary: { where: 'cloud', minTier: 'free', label: 'lib.capabilities.label.soundLibrary' },
};

export function capabilityWhere(cap: CapabilityId): Where {
  return CAPABILITIES[cap].where;
}

/** A művelethez szükséges MINIMÁLIS előfizetési szint (audit §2.1). */
export function capabilityMinTier(cap: CapabilityId): Tier {
  return CAPABILITIES[cap].minTier;
}

/** Engedélyezett-e a művelet az adott user-szinten (rangsor szerint, tier-pontos gate). */
export function capabilityAllowed(cap: CapabilityId, userTier: Tier): boolean {
  return tierMeetsMin(userTier, capabilityMinTier(cap));
}

/**
 * Fizetős-e a képesség (bármi a free fölött). Backward-compat név: a mai rendszerben a
 * fizetős szint = Pro, ezért a viselkedés változatlan; a hívók (paywall/backend-router)
 * módosítás nélkül működnek. Az ÚJ, szint-pontos kapuzáshoz a `capabilityAllowed` megy.
 */
export function capabilityRequiresPro(cap: CapabilityId): boolean {
  return isPaidTier(capabilityMinTier(cap));
}

export function capabilityLabel(cap: CapabilityId): string {
  return tr(CAPABILITIES[cap].label);
}

/** A fizetős képességek listája — a paywall „mit kapsz" felsorolásához. */
export function proCapabilities(): string[] {
  return Object.values(CAPABILITIES)
    .filter((c) => isPaidTier(c.minTier))
    .map((c) => tr(c.label));
}
