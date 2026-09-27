import { capabilityRequiresPro, type CapabilityId } from '@/lib/capabilities';

/**
 * 🤖 Generatív média (S-GENAI — MASTER §12, audit ★) — a „0 generatív média" rés
 * betöltése a MODELL + VALIDÁCIÓ szintjén: text→kép/kép→kép/inpaint/outpaint,
 * text/kép→videó, gen-zene, voice-clone, AI-avatar. Mind `cloud`+`pro` capability
 * (a katalógusból), provider-adapterrel (a tényleges inferencia a workeren/BYOK).
 *
 * Tiszta, expo-mentes: a kérés-modell + bemenet-validáció + a workernek szánt
 * deklaratív job-terv. Az etikát is modellezi (voice-clone = kötelező hozzájárulás).
 */

export type GenMediaKind = 'image' | 'imageEdit' | 'inpaint' | 'outpaint' | 'video' | 'music' | 'voiceClone' | 'avatar';

export const GEN_MEDIA_KINDS: GenMediaKind[] = [
  'image',
  'imageEdit',
  'inpaint',
  'outpaint',
  'video',
  'music',
  'voiceClone',
  'avatar',
];

interface GenKindMeta {
  capability: CapabilityId;
  label: string;
  requires: { prompt?: boolean; source?: boolean; mask?: boolean; ref?: boolean; consent?: boolean };
  /** időtartam-korlát (mp) — videó/zene */
  duration?: [number, number];
}

export const GEN_MEDIA: Record<GenMediaKind, GenKindMeta> = {
  image: { capability: 'genImage', label: 'genMedia.kind.image', requires: { prompt: true } },
  imageEdit: { capability: 'genImage', label: 'genMedia.kind.imageEdit', requires: { source: true, prompt: true } },
  inpaint: { capability: 'genImage', label: 'genMedia.kind.inpaint', requires: { source: true, mask: true, prompt: true } },
  outpaint: { capability: 'genImage', label: 'genMedia.kind.outpaint', requires: { source: true } },
  video: { capability: 'genVideo', label: 'genMedia.kind.video', requires: { prompt: true }, duration: [1, 60] },
  music: { capability: 'genMusic', label: 'genMedia.kind.music', requires: { prompt: true }, duration: [1, 300] },
  voiceClone: { capability: 'voiceClone', label: 'genMedia.kind.voiceClone', requires: { ref: true, prompt: true, consent: true } },
  avatar: { capability: 'aiAvatar', label: 'genMedia.kind.avatar', requires: { prompt: true } },
};

export interface GenRequest {
  kind: GenMediaKind;
  prompt?: string;
  /** forrás-kép/videó (kép→kép, inpaint, outpaint, image→video) */
  sourceUri?: string;
  /** maszk (inpaint) */
  maskUri?: string;
  /** referencia (voice-clone hangminta, avatar-arc) */
  refUri?: string;
  /** másodperc (videó/zene) */
  durationSec?: number;
  /** a modell-specifikus extra paraméterek (seed/steps/stílus…) */
  params?: Record<string, unknown>;
  /** voice-clone: az érintett HOZZÁJÁRULT a hangja használatához */
  consent?: boolean;
}

/** A művelet a katalógus szerint Pro-t igényel-e (mindig, de a katalógusból olvasva). */
export function genRequiresPro(kind: GenMediaKind): boolean {
  return capabilityRequiresPro(GEN_MEDIA[kind].capability);
}

export function genCapability(kind: GenMediaKind): CapabilityId {
  return GEN_MEDIA[kind].capability;
}

export type GenErrorCode =
  | 'missing_prompt'
  | 'missing_source'
  | 'missing_mask'
  | 'missing_ref'
  | 'missing_consent'
  | 'duration_out_of_range';

export interface GenError {
  code: GenErrorCode;
  detail?: string;
}

/** A kérés bemeneteinek validációja a kind követelményei szerint. */
export function validateGenRequest(req: GenRequest): { ok: boolean; errors: GenError[] } {
  const meta = GEN_MEDIA[req.kind];
  const r = meta.requires;
  const errors: GenError[] = [];
  if (r.prompt && !req.prompt?.trim()) {
    errors.push({ code: 'missing_prompt' });
  }
  if (r.source && !req.sourceUri) {
    errors.push({ code: 'missing_source' });
  }
  if (r.mask && !req.maskUri) {
    errors.push({ code: 'missing_mask' });
  }
  if (r.ref && !req.refUri) {
    errors.push({ code: 'missing_ref' });
  }
  if (r.consent && req.consent !== true) {
    errors.push({ code: 'missing_consent' });
  }
  if (meta.duration && req.durationSec !== undefined) {
    const [lo, hi] = meta.duration;
    if (req.durationSec < lo || req.durationSec > hi) {
      errors.push({ code: 'duration_out_of_range', detail: `${lo}-${hi}s` });
    }
  }
  return { ok: errors.length === 0, errors };
}

export interface GenJobPlan {
  kind: GenMediaKind;
  capability: CapabilityId;
  prompt?: string;
  sourceUri?: string;
  maskUri?: string;
  refUri?: string;
  durationSec?: number;
  params: Record<string, unknown>;
}

/**
 * A workernek szánt deklaratív job-terv (csak érvényes kérésre — a hívó előbb
 * `validateGenRequest`-et futtat). Nem tartalmaz provider-specifikus stringet;
 * a provider-adapter (aiProviders-minta) ebből épít konkrét hívást.
 */
export function buildGenPlan(req: GenRequest): GenJobPlan {
  return {
    kind: req.kind,
    capability: genCapability(req.kind),
    ...(req.prompt ? { prompt: req.prompt.trim() } : {}),
    ...(req.sourceUri ? { sourceUri: req.sourceUri } : {}),
    ...(req.maskUri ? { maskUri: req.maskUri } : {}),
    ...(req.refUri ? { refUri: req.refUri } : {}),
    ...(req.durationSec !== undefined ? { durationSec: req.durationSec } : {}),
    params: req.params ?? {},
  };
}
