import type { EditorCommand } from '@/lib/commands';
import { snapToFrame } from '@/lib/frames';
import { logCaught } from '@/lib/logCaught';
import type { Asset, AssetSource, AudioClip, Clip, Project, TrackType } from '@/types/project';

/**
 * 🔗 Linked asset (ReMix.md 5.3 · PRO-SHARED-CORE SC2 · AUDIO-PROD C2) — pure mag.
 *
 * A stúdiók közti átadás HIVATKOZÁS, nem másolat (A2): a videó-projekt zene-klipje egy másik
 * (hang-)projekt *kimenetére* (mixdown) mutat, verzióval. A forrás tartalma minden mentéskor új
 * verziót kap (a tartalomból számolt kulcs, nem számláló → offline és eszközök közt is
 * determinisztikus); a hivatkozó projekt megnyitáskor összeveti, és „Frissítés elérhető” jelzést
 * ad. A csere EGY koppintás = EGY köteg a parancs-buszon (egy visszavonás). Néma automatikus
 * csere nincs: a felhasználó dönt, mert a vágás az új hosszhoz igazodhat.
 *
 * Hossz-változás szabálya (SC2): ha az új kimenet RÖVIDEBB, a klip vége a forrás végére vágódik
 * és a hívó jelzést kap (`shortened`); ha HOSSZABB, a klip változatlan (a `sourceDuration` nő,
 * így a jobb él kihúzható).
 */

export const MIXDOWN_OUTPUT = 'mixdown' as const;
export type { AssetSource };

/** FNV-1a 32 bit — elavulás-észlelés, nem biztonsági cél (mint a `songRenderKey`) */
function fnv(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${text.length.toString(36)}-${hash.toString(36)}`;
}

/**
 * A tartalom-kulcs szerializálója: ami a hangot NEM változtatja, de a mentés/betöltés átírhatja,
 * kimarad — a fájl uri-ja a mappába-vételkor (`prepareProjectFolder`) új útvonalat kap (a neve
 * marad), az `assetId`-t a betöltés pótolja (`ensureClipAssets`). Különben a videó HAMIS
 * „Frissítés elérhető"-t jelezne, pedig a zene nem változott (eszközön mérve 2026-11-14).
 */
function contentReplacer(key: string, value: unknown): unknown {
  if (key === 'assetId') return undefined;
  if (key === 'uri' && typeof value === 'string') {
    const name = value.slice(value.lastIndexOf('/') + 1);
    try {
      return decodeURIComponent(name);
    } catch (caught) {
      logCaught('lib/linkedAsset.ts:contentReplacer', caught);
      return name; // hibás százalék-kódolás: a nyers név is stabil kulcs
    }
  }
  return value;
}

/**
 * A hang-projekt KIMENET-VERZIÓJA: minden, ami a keverés hangját adja (sávok és klipek, master,
 * sávmix, buszok, küldések, tempó). Ami csak nézet (jelölők, zoom, kijelölés) vagy meta (név,
 * mappa, frissítés ideje, a fájl útvonala, asset-azonosító), az nem számít → a mentés önmagában
 * nem jelez frissítést.
 */
export function mixdownVersion(
  p: Pick<Project, 'tracks' | 'audioMaster' | 'trackMix' | 'audioBuses' | 'audioSends' | 'bpm'>
): string {
  return fnv(
    JSON.stringify(
      {
        tracks: p.tracks,
        audioMaster: p.audioMaster ?? null,
        trackMix: p.trackMix ?? null,
        audioBuses: p.audioBuses ?? null,
        audioSends: p.audioSends ?? null,
        bpm: p.bpm ?? null,
      },
      contentReplacer
    )
  );
}

/** a projekt hivatkozott (linkelt) assetjei */
export function linkedAssets(project: Pick<Project, 'assets'>): Asset[] {
  return project.assets.filter((a) => !!a.source);
}

export interface StaleLink {
  asset: Asset;
  /** a forrás mostani verziója */
  currentVersion: string;
}

/**
 * Melyik linkelt asset mögött van újabb forrás-verzió. A `versionOf` a forrás-projekt mostani
 * verzióját adja (a hívó tölti be a projektet — helyben, felhő nélkül); `null` = a forrás nincs
 * meg (társnál, törölve) → nem jelzünk, a link a meglévő kimenetre mutat tovább.
 */
export function staleLinks(project: Pick<Project, 'assets'>, versionOf: (projectId: string) => string | null): StaleLink[] {
  const out: StaleLink[] = [];
  for (const asset of linkedAssets(project)) {
    const cur = versionOf(asset.source!.projectId);
    if (cur && cur !== asset.source!.version) out.push({ asset, currentVersion: cur });
  }
  return out;
}

/** hova kerüljön a mixdown a célprojekt zene-sávján: üres sáv → 0, különben az utolsó klip után */
export function mixdownInsertAt(project: Pick<Project, 'tracks' | 'fps'>, trackType: TrackType = 'music'): number {
  const track = project.tracks.find((t) => t.type === trackType);
  const end = track ? track.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0) : 0;
  return snapToFrame(end, project.fps ?? 30);
}

export interface MixdownFile {
  uri: string;
  durationSec: number;
}

/**
 * A mixdown HIVATKOZOTT klipként a célprojektbe (zene-sáv): egy `ADD_CLIP` az assettel (a reducer
 * az assetet is felveszi). Az asset `source`-a hordozza a hivatkozást és a verziót.
 */
export function mixdownClipCommands(opts: {
  source: AssetSource;
  file: MixdownFile;
  at: number;
  fps: number;
  label: string;
  clipId: string;
  assetId: string;
  trackType?: TrackType;
}): EditorCommand[] {
  const d = Math.max(0.01, opts.file.durationSec);
  const clip: AudioClip = {
    kind: 'audio',
    id: opts.clipId,
    start: snapToFrame(opts.at, opts.fps),
    duration: d,
    trimIn: 0,
    sourceDuration: d,
    uri: opts.file.uri,
    label: opts.label,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    source: 'imported',
  };
  const asset: Asset = { id: opts.assetId, kind: 'audio', uri: opts.file.uri, provider: 'local', name: opts.label, duration: d, source: opts.source };
  return [{ type: 'ADD_CLIP', trackType: opts.trackType ?? 'music', clip, asset }];
}

export interface RelinkPlan {
  commands: EditorCommand[];
  /** a klipek, amelyeket az új, rövidebb kimenet miatt meg kellett vágni */
  shortened: string[];
}

const isAudio = (c: Clip): c is AudioClip => c.kind === 'audio';

/**
 * Frissítés az új kimenetre: az asset új fájlja + verziója, és minden hivatkozó klip hossz-szabálya
 * (rövidebb → a forrás végére vágva és jelezve; hosszabb → változatlan). Egy köteg = egy visszavonás.
 */
export function relinkPlan(project: Project, assetId: string, next: MixdownFile & { version: string }): RelinkPlan {
  const asset = project.assets.find((a) => a.id === assetId);
  if (!asset || !asset.source) return { commands: [], shortened: [] };
  const newSrc = Math.max(0.01, next.durationSec);
  const commands: EditorCommand[] = [
    { type: 'RELINK_ASSET', assetId, newUri: next.uri, source: { ...asset.source, version: next.version }, duration: newSrc },
  ];
  const shortened: string[] = [];
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (!isAudio(clip) || (clip.assetId ? clip.assetId !== assetId : clip.uri !== asset.uri)) continue;
      const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
      const trimIn = clip.trimIn ?? 0;
      const patch: Partial<AudioClip> = { sourceDuration: newSrc };
      if (trimIn >= newSrc) {
        // a klip teljes ablaka az új forráson kívül esik → a forrás utolsó pillanata
        patch.trimIn = Math.max(0, newSrc - 0.01);
        patch.duration = 0.01;
        if (clip.loopLength) patch.loopLength = 0.01;
        shortened.push(clip.id);
      } else if (clip.loopLength) {
        if (trimIn + clip.loopLength > newSrc + 1e-6) {
          patch.loopLength = newSrc - trimIn;
          shortened.push(clip.id);
        }
      } else {
        const maxDur = (newSrc - trimIn) / speed;
        if (clip.duration > maxDur + 1e-6) {
          patch.duration = Math.max(0.01, maxDur);
          shortened.push(clip.id);
        }
      }
      commands.push({ type: 'UPDATE_CLIP', clipId: clip.id, patch });
    }
  }
  return { commands, shortened };
}
