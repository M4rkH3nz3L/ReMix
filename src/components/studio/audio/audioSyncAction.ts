import type { TFunction } from 'i18next';
import { Alert } from 'react-native';

import { SYNC_MIN_CONFIDENCE } from '@/lib/audioSync';
import { SYNC_SEARCH_SEC, syncable, syncClipTo, type ClipSync } from '@/lib/audioSyncClient';
import { useEditorStore } from '@/store/editorStore';
import { withProgress } from '@/store/progressStore';
import type { AudioClip } from '@/types/project';

/**
 * 🔗 „Szinkron a másik sávhoz”: a kijelölt (külső) klipet a hangja alapján egy másik sáv klipjéhez
 * igazítja. A referencia-jelöltek a többi sáv klipjei a keresési tartományban, átfedés szerint;
 * több jelöltnél a felhasználó választ. Az eredmény egy `UPDATE_CLIP` (undo).
 */

/** a referencia-jelöltek a klip ±30 s-os környezetében, a legnagyobb átfedés elöl */
export function syncCandidates(ext: AudioClip): AudioClip[] {
  const project = useEditorStore.getState().project;
  if (!project) return [];
  const own = project.tracks.find((t) => t.clips.some((c) => c.id === ext.id));
  const lo = ext.start - SYNC_SEARCH_SEC;
  const hi = ext.start + ext.duration + SYNC_SEARCH_SEC;
  const overlap = (c: AudioClip) => Math.min(hi, c.start + c.duration) - Math.max(lo, c.start);
  return project.tracks
    .filter((t) => t !== own)
    .flatMap((t) => t.clips)
    .filter((c): c is AudioClip => c.kind === 'audio' && syncable(c) && overlap(c) > 1)
    .sort((a, b) => overlap(b) - overlap(a));
}

/** a szinkron lefuttatása és alkalmazása; @returns az eredmény (dev-mérésekhez), vagy null */
export async function runAudioSync(ext: AudioClip, ref: AudioClip, fps: number, t: TFunction, quiet = false): Promise<ClipSync | null> {
  const r = await withProgress(t('studio.audio.sync.working'), () => syncClipTo(ref, ext, fps));
  if (!r || r.confidence < SYNC_MIN_CONFIDENCE || !r.patch) {
    if (!quiet) Alert.alert(t('studio.audio.sync.title'), t('studio.audio.sync.noMatch', { sec: SYNC_SEARCH_SEC }));
    return r;
  }
  useEditorStore.getState().dispatch({ type: 'UPDATE_CLIP', clipId: ext.id, patch: r.patch }, 'user');
  if (!quiet) {
    Alert.alert(
      t('studio.audio.sync.title'),
      t('studio.audio.sync.done', { ms: Math.round((r.target - ext.start) * 1000), name: ref.label, conf: r.confidence.toFixed(1) })
    );
  }
  return r;
}

/** a klipszerkesztő gombja: jelölt-választás, majd szinkron */
export function startAudioSync(ext: AudioClip, fps: number, t: TFunction): void {
  if (!syncable(ext)) {
    Alert.alert(t('studio.audio.sync.title'), t('studio.audio.sync.unsupported'));
    return;
  }
  const cands = syncCandidates(ext);
  if (cands.length === 0) {
    Alert.alert(t('studio.audio.sync.title'), t('studio.audio.sync.noRef', { sec: SYNC_SEARCH_SEC }));
    return;
  }
  if (cands.length === 1) {
    void runAudioSync(ext, cands[0], fps, t);
    return;
  }
  Alert.alert(t('studio.audio.sync.title'), t('studio.audio.sync.pick'), [
    ...cands.slice(0, 3).map((c) => ({ text: c.label, onPress: () => void runAudioSync(ext, c, fps, t) })),
    { text: t('common.cancel'), style: 'cancel' as const },
  ]);
}
