import { File } from 'expo-file-system';

import { mixForExport } from '@/lib/audioExportMix';
import { applyCommand } from '@/lib/commands';
import { makeId } from '@/lib/id';
import { mixdownClipCommands, mixdownInsertAt, mixdownVersion, type AssetSource, type MixdownFile } from '@/lib/linkedAsset';
import { logCaught } from '@/lib/logCaught';
import { exportOfflineWav } from '@/lib/offlineMixClient';
import type { ProgressUpdate } from '@/lib/progress';
import { projectMediaDir } from '@/lib/projectFolderClient';
import { createEmptyProject } from '@/lib/projectUtils';
import { loadProject, saveProject } from '@/lib/storage';
import type { Project } from '@/types/project';

/**
 * 🔗 Linked asset — a HÁLÓZATI/ESZKÖZ réteg a pure `linkedAsset.ts` magjához (AUDIO-PROD C2).
 *
 * A mixdown a forrás hang-projekt TELJES keverése (minden sáv hallható, master-hangerő 1 — a
 * némítás/szóló munkamenet-szintű nézet, nem a mű része), a telefonon renderelve
 * (`exportOfflineWav`, ugyanaz a DSP, mint az előnézet és az export → preview = export). Felhő
 * nem kell (A3). A fájl a projekt-mappába kerül (`projectMediaDir`), a mentés mappába-vétele
 * és a média-GC a projekt-JSON szövegéből látja.
 */

/** a forrás-projekt betöltése helyben (felhő nélkül); null = nincs meg (társnál, törölve) */
export async function loadSourceProject(projectId: string): Promise<Project | null> {
  try {
    return await loadProject(projectId);
  } catch (caught) {
    logCaught('lib/linkedAssetClient.ts:loadSourceProject', caught);
    return null;
  }
}

/** a forrás mostani kimenet-verziója, vagy null, ha a forrás nincs meg */
export async function sourceVersionOf(projectId: string): Promise<string | null> {
  const p = await loadSourceProject(projectId);
  return p ? mixdownVersion(p) : null;
}

/** a hang-projekt mixdownja WAV-ként a projekt-mappába; a verzió a tartalomból */
export async function renderMixdown(
  source: Project,
  onProgress?: (u: ProgressUpdate) => void,
  signal?: AbortSignal
): Promise<(MixdownFile & { version: string }) | null> {
  const mix = mixForExport(source, () => true, 1);
  if (!mix) return null;
  const version = mixdownVersion(source);
  const dir = projectMediaDir();
  if (!dir.exists) dir.create();
  const safe = source.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'mixdown';
  const target = new File(dir, `mixdown_${safe}_${version}.wav`);
  const { uri } = await exportOfflineWav(mix, target, onProgress, signal);
  const durationSec = mixdownDuration(mix);
  return { uri, durationSec, version };
}

/** a keverés hossza a klipekből (a WAV-fejléc helyett — a mintapontos hossz ugyanebből a tervből készül) */
export function mixdownDuration(mix: Pick<Project, 'tracks'>): number {
  let end = 0;
  for (const t of mix.tracks) for (const c of t.clips) end = Math.max(end, c.start + c.duration);
  return end;
}

/** a hivatkozás egy hang-projektre (a videó assetjén) */
export function sourceFor(audio: Project): AssetSource {
  return { projectId: audio.id, name: audio.name, output: 'mixdown', version: mixdownVersion(audio) };
}

/**
 * 🎧→🎬 A hang-projekt mixdownja HIVATKOZÁSKÉNT egy videó-projektbe (ReMix.md 8.1 3. lépés):
 * `target` = meglévő videó-projekt (a klip a zene-sáv végére), vagy null = új videó-projekt. A
 * cél nincs a store-ban → a pure reducer (`applyCommand`) írja, aztán mentés. A hívó navigál.
 * @returns a célprojekt (mentve), vagy null, ha a hang üres / a render megszakadt
 */
export async function sendMixdownToVideo(
  audio: Project,
  target: Project | null,
  opts: { newName: string; onProgress?: (u: ProgressUpdate) => void; signal?: AbortSignal }
): Promise<Project | null> {
  const file = await renderMixdown(audio, opts.onProgress, opts.signal);
  if (!file) return null;
  let video: Project = target ?? createEmptyProject(opts.newName, audio.aspectRatio, undefined, 'video');
  if (!target && audio.bpm) video = { ...video, bpm: audio.bpm };
  const cmds = mixdownClipCommands({
    source: sourceFor(audio),
    file,
    at: mixdownInsertAt(video),
    fps: video.fps ?? 30,
    label: audio.name,
    clipId: makeId('clip'),
    assetId: makeId('ast'),
  });
  for (const cmd of cmds) video = applyCommand(video, cmd) ?? video;
  await saveProject(video);
  return video;
}
