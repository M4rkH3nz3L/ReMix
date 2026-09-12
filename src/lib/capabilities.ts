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

export type Where = 'local' | 'cloud';

export type CapabilityId =
  // ── ESZKÖZÖN, INGYEN ────────────────────────────────────────────────
  | 'localRender' // alap MP4 export a telefonon (natív AVFoundation/MediaCodec)
  // ── FELHŐ-WORKER, PRO ───────────────────────────────────────────────
  | 'cloudRender' // felhő HD/4K render (queue + S3), gyorsabb, nagyobb felbontás
  | 'autoCaption' // Whisper: beszéd → felirat
  | 'urlImport' // import linkből (YouTube / TikTok / …)
  | 'autoEdit' // AI Auto-Edit / cutplan / hook-ok
  | 'storyAnalyze' // AI story-struktúra (Hook→Context→Value→CTA felismerés)
  | 'pacingAnalyze' // AI tempó-elemzés (beszéd/csend/vágás-jelek → lassú szakaszok)
  | 'qualityScan' // felvétel-minőség ellenőrzés (homályos / alul-túlexponált kockák)
  | 'cloudSync' // projekt felhő-mentés/visszaállítás (cloud-tárhely)
  | 'bgRemove' // háttér-eltávolítás
  | 'depth3d' // mélység / 3D / parallax
  | 'faceTools' // arc-követés / retusálás
  | 'reframe' // AI újrakeretezés (vízszintes → álló)
  | 'upscale' // felskálázás
  | 'skyReplace' // ég-csere
  | 'colorAi' // AI szín / auto-grade
  | 'tts' // szöveg → beszéd / Voice Studio
  | 'soundLibrary'; // worker hang-könyvtár (ingyenes felhő-funkció)

/**
 * A `where`/`pro` kombináció TÍPUS-SZINTEN kódolja a szigorú üzleti szabályt:
 * ami az ESZKÖZÖN fut (`where: 'local'`), az KÖTELEZŐEN ingyenes (`pro: false`)
 * — on-device funkciót soha nem kapuzunk Pro mögé. Felhő-funkció (`'cloud'`)
 * lehet Pro, vagy — ritkán, szándékosan — ingyenes (pl. `soundLibrary`).
 *
 * Következmény: egy `{ where: 'local', pro: true }` sor FORDÍTÁSI HIBÁT ad, így
 * a szabály minden `tsc --noEmit` futásnál automatikusan auditálva van.
 */
type CapabilityMeta =
  | { where: 'local'; pro: false; label: string }
  | { where: 'cloud'; pro: boolean; label: string };

export const CAPABILITIES: Record<CapabilityId, CapabilityMeta> = {
  localRender: { where: 'local', pro: false, label: 'lib.capabilities.label.localRender' },

  cloudRender: { where: 'cloud', pro: true, label: 'lib.capabilities.label.cloudRender' },
  autoCaption: { where: 'cloud', pro: true, label: 'lib.capabilities.label.autoCaption' },
  urlImport: { where: 'cloud', pro: true, label: 'lib.capabilities.label.urlImport' },
  autoEdit: { where: 'cloud', pro: true, label: 'lib.capabilities.label.autoEdit' },
  storyAnalyze: { where: 'cloud', pro: true, label: 'lib.capabilities.label.storyAnalyze' },
  pacingAnalyze: { where: 'cloud', pro: true, label: 'lib.capabilities.label.pacingAnalyze' },
  qualityScan: { where: 'cloud', pro: true, label: 'lib.capabilities.label.qualityScan' },
  cloudSync: { where: 'cloud', pro: true, label: 'lib.capabilities.label.cloudSync' },
  bgRemove: { where: 'cloud', pro: true, label: 'lib.capabilities.label.bgRemove' },
  depth3d: { where: 'cloud', pro: true, label: 'lib.capabilities.label.depth3d' },
  faceTools: { where: 'cloud', pro: true, label: 'lib.capabilities.label.faceTools' },
  reframe: { where: 'cloud', pro: true, label: 'lib.capabilities.label.reframe' },
  upscale: { where: 'cloud', pro: true, label: 'lib.capabilities.label.upscale' },
  skyReplace: { where: 'cloud', pro: true, label: 'lib.capabilities.label.skyReplace' },
  colorAi: { where: 'cloud', pro: true, label: 'lib.capabilities.label.colorAi' },
  tts: { where: 'cloud', pro: true, label: 'lib.capabilities.label.tts' },
  // a hang-könyvtár felhőből jön, de minden felhasználónak jár
  soundLibrary: { where: 'cloud', pro: false, label: 'lib.capabilities.label.soundLibrary' },
};

export function capabilityWhere(cap: CapabilityId): Where {
  return CAPABILITIES[cap].where;
}

export function capabilityRequiresPro(cap: CapabilityId): boolean {
  return CAPABILITIES[cap].pro;
}

export function capabilityLabel(cap: CapabilityId): string {
  return tr(CAPABILITIES[cap].label);
}

/** A Pro-only képességek listája — a paywall „mit kapsz" felsorolásához. */
export function proCapabilities(): CapabilityMeta['label'][] {
  return Object.values(CAPABILITIES)
    .filter((c) => c.pro)
    .map((c) => tr(c.label));
}
