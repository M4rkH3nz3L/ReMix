import { buildAiContext, validateAiCommand, type AiCommand } from '@/lib/aiCommands';
import { buildAutoEditContext } from '@/lib/autoedit';
import type { AiProvider, AiTask } from '@/lib/aiProviders'; // type-only → nem húzza be a supabase-réteget
import type { Project, Track, VideoClip } from '@/types/project';

/**
 * 🧪 AI-provider feladat-vizsga — tiszta mag (local-ai 5.3).
 *
 * A user által hozzáadott modell (BYOK) mentés után feladatonként EGY kanonikus
 * mini-feladatot kap (golden bemenet), és a válasza ITT, determinisztikusan
 * értékelődik: az `assistant` kimenetén a VALÓDI `validateAiCommand` fut le egy
 * fixture-projekt ellen (ugyanaz a határ, mint élesben), a többi feladatnál a
 * kimenet-séma ellenőrződik. CSAK a sikeres feladatok kerülnek a provider
 * `validated_tasks` listájába — és a feloldó (`aiConfigForTask`) híváskor újra
 * ellenőrzi (`examAllowsTask`), tehát a modell tényleg csak arra fogható,
 * amire bevizsgázott. A hálózati futtatás az `aiExamClient`-ben van.
 */

/** a vizsga-definíciók verziója — változáskor a régi eredmények újra-vizsgát érnek */
export const EXAM_VERSION = 1;

/**
 * Provider-ujjlenyomat: amire a vizsga-eredmény vonatkozik. A `provider`/`baseUrl`/
 * `model` bármelyikének változása más modellt jelent → az eredmény érvénytelen.
 */
export function providerFingerprint(
  p: Pick<AiProvider, 'provider' | 'baseUrl' | 'model'>,
): string {
  return `v${EXAM_VERSION}|${p.provider}|${p.baseUrl.trim()}|${p.model.trim()}`;
}

/**
 * Engedi-e a vizsga-állapot a feladatot?
 *  - `validatedTasks` nincs (legacy sor, vizsga előtt) → ENGED (átmeneti kegyelem:
 *    a meglévő providerek nem törnek el; mentéskor a vizsga automatikusan lefut).
 *  - ujjlenyomat-eltérés (modell/URL változott a vizsga óta) → NEM enged.
 *  - különben: csak a bevizsgázott feladat megy.
 */
export function examAllowsTask(
  p: Pick<AiProvider, 'provider' | 'baseUrl' | 'model' | 'validatedTasks' | 'validatedModel'>,
  task: AiTask,
): boolean {
  if (p.validatedTasks == null) {
    return true;
  }
  if (p.validatedModel !== providerFingerprint(p)) {
    return false;
  }
  return p.validatedTasks.includes(task);
}

/** Determinista mini-projekt a vizsgához (a validateAiCommand VALÓDI cél ellen fut). */
export function examFixtureProject(): Project {
  const clip: VideoClip = {
    kind: 'video',
    id: 'clip_exam_video',
    start: 0,
    duration: 8,
    uri: 'file://exam.mp4',
    trimIn: 0,
    sourceDuration: 8,
    speed: 1,
    volume: 1,
    filterId: 'none',
  };
  const video: Track = { id: 't_video', type: 'video', name: 'Videó', clips: [clip] };
  const captions: Track = { id: 't_captions', type: 'captions', name: 'Felirat', clips: [] };
  return {
    id: 'proj_exam',
    name: 'Vizsga-projekt',
    aspectRatio: '9:16',
    fps: 30,
    tracks: [video, captions],
    assets: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 6,
  };
}

export interface ExamRequest {
  task: AiTask;
  /** worker-végpont (a kliens a base-url + aiConfig beillesztésével hívja) */
  path: string;
  /** golden kérés-test aiConfig NÉLKÜL (azt a kliens teszi hozzá) */
  body: Record<string, unknown>;
  /** Pro-kapus végpont → free tieren a vizsga 'blocked' (nem a modell hibája) */
  proOnly: boolean;
}

/** a caption-vizsga golden szegmensei (az értékelés az id-kre hivatkozik) */
export const EXAM_CAPTION_SEGMENTS = [
  { id: 'seg_1', text: 'ez a legfontosabb mondat a videóban' },
  { id: 'seg_2', text: 'itt jön a nagy csavar a történetben' },
] as const;

/** Feladat → golden kérés (determinista; a fixture-projektből építkezik). */
export function examRequestForTask(task: AiTask, fixture: Project): ExamRequest {
  switch (task) {
    case 'assistant':
      return {
        task,
        path: '/ai/assist',
        proOnly: false,
        body: {
          context: buildAiContext(fixture, 0, null, []),
          instruction:
            'Vágd ketté a videóklipet pontosan 4 másodpercnél, és adj egy rövid címfeliratot a videó elejére.',
        },
      };
    case 'autoEdit':
      return {
        task,
        path: '/ai/autoedit',
        proOnly: true,
        body: {
          context: buildAutoEditContext({
            duration: 8,
            targetSeconds: 5,
            scenes: [3.2],
            transcript: [
              { start: 0.4, end: 2.8, text: 'ez a felvezetés' },
              { start: 4.6, end: 7.4, text: 'ez pedig a lényeg' },
            ],
            silences: [{ start: 2.8, end: 4.6 }],
            beats: [],
            bpm: 0,
          }),
        },
      };
    case 'captionStudio':
      return {
        task,
        path: '/ai/captionstudio',
        proOnly: false,
        body: { segments: EXAM_CAPTION_SEGMENTS.map((s) => ({ ...s })) },
      };
    case 'hooks':
      return {
        task,
        path: '/ai/hooks',
        proOnly: false,
        body: { summary: 'Rövid videó arról, hogyan tanultam meg 30 nap alatt gitározni.' },
      };
    case 'thumbHeadlines':
      return {
        task,
        path: '/ai/thumbheadlines',
        proOnly: false,
        body: { summary: 'Rövid videó arról, hogyan tanultam meg 30 nap alatt gitározni.' },
      };
    case 'storyStructure':
      return {
        task,
        path: '/ai/story',
        proOnly: true,
        body: {
          context: {
            duration: 30,
            transcript: [
              { start: 0.5, end: 3, text: 'figyelj, ez megváltoztatta az életem' },
              { start: 4, end: 12, text: 'harminc napja minden nap gyakoroltam' },
              { start: 13, end: 24, text: 'és a huszadik napon történt valami' },
              { start: 25, end: 29, text: 'kövess, ha te is bele akarsz vágni' },
            ],
          },
        },
      };
  }
}

export type ExamVerdict = { ok: true } | { ok: false; reason: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function nonEmptyString(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * A worker-válasz determinista értékelése feladatonként. A séma-bukás pontos
 * indokot ad (a kártya mutatja) — a „majdnem jó" kimenet is bukás (BP-13).
 */
export function evaluateExamResponse(
  task: AiTask,
  body: unknown,
  fixture: Project,
): ExamVerdict {
  if (!isRecord(body)) {
    return { ok: false, reason: 'nem JSON-objektum válasz' };
  }
  switch (task) {
    case 'assistant': {
      const commands = body.commands;
      if (!Array.isArray(commands) || commands.length === 0) {
        return { ok: false, reason: 'nincs commands tömb' };
      }
      // a VALÓDI authz-határ a fixture ellen: legalább egy érvényes parancs kell
      const valid = commands.filter(
        (c) => isRecord(c) && validateAiCommand(c as unknown as AiCommand, fixture).ok,
      );
      return valid.length > 0
        ? { ok: true }
        : { ok: false, reason: 'egyetlen parancs sem ment át a validateAiCommand-on' };
    }
    case 'autoEdit': {
      const variants = body.variants;
      if (!Array.isArray(variants) || variants.length === 0) {
        return { ok: false, reason: 'nincs variants tömb' };
      }
      const ok = variants.some(
        (v) =>
          isRecord(v) &&
          Array.isArray(v.keep) &&
          v.keep.length > 0 &&
          v.keep.every(
            (k: unknown) =>
              isRecord(k) &&
              typeof k.start === 'number' &&
              typeof k.end === 'number' &&
              k.end > k.start,
          ),
      );
      return ok ? { ok: true } : { ok: false, reason: 'nincs érvényes keep-listás változat' };
    }
    case 'captionStudio': {
      const segments = body.segments;
      if (!Array.isArray(segments) || segments.length === 0) {
        return { ok: false, reason: 'nincs segments tömb' };
      }
      const ids = new Set<string>(EXAM_CAPTION_SEGMENTS.map((s) => s.id));
      const ok = segments.some(
        (s) =>
          isRecord(s) &&
          ids.has(String(s.id)) &&
          Array.isArray(s.emphasis) &&
          s.emphasis.every((n: unknown) => typeof n === 'number') &&
          typeof s.emoji === 'string',
      );
      return ok
        ? { ok: true }
        : { ok: false, reason: 'nincs a golden szegmensekre illő javaslat' };
    }
    case 'hooks': {
      const hooks = body.hooks;
      if (!Array.isArray(hooks)) {
        return { ok: false, reason: 'nincs hooks tömb' };
      }
      const valid = hooks.filter((h) => isRecord(h) && nonEmptyString(h.text));
      return valid.length >= 3
        ? { ok: true }
        : { ok: false, reason: `kevés használható hook (${valid.length}/3)` };
    }
    case 'thumbHeadlines': {
      const headlines = body.headlines;
      if (!Array.isArray(headlines)) {
        return { ok: false, reason: 'nincs headlines tömb' };
      }
      return headlines.filter(nonEmptyString).length > 0
        ? { ok: true }
        : { ok: false, reason: 'nincs használható címjavaslat' };
    }
    case 'storyStructure': {
      const chapters = body.chapters;
      if (!Array.isArray(chapters)) {
        return { ok: false, reason: 'nincs chapters tömb' };
      }
      const valid = chapters.filter(
        (c) => isRecord(c) && typeof c.start === 'number' && Number.isFinite(c.start),
      );
      return valid.length >= 2
        ? { ok: true }
        : { ok: false, reason: `kevés érvényes fejezet (${valid.length}/2)` };
    }
  }
}
