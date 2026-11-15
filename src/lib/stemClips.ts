import type { EditorCommand } from '@/lib/commands';
import type { AudioClip, Project, TrackType } from '@/types/project';

export interface StemSource {
  name: string;
  url: string;
}

/**
 * 🎚️ Stemek klipként (PRO-AUDIO A3): a szeparálás a TELJES forrásfájlt dolgozza fel, ezért a
 * stem ugyanazt a vágást kapja, mint az eredeti klip, különben más szakasz szólna. A klip
 * minden beállítása (fade, pan, effekt, automáció) a stemeken folytatódik.
 */
export function stemClipsFrom(
  clip: AudioClip,
  stems: StemSource[],
  makeId: () => string
): { trackType: TrackType; clip: AudioClip }[] {
  const trimIn = clip.trimIn ?? 0;
  return stems.map((stem) => {
    const trackType: TrackType = stem.name === 'vocals' ? 'voiceover' : 'sfx';
    return {
      trackType,
      clip: {
        ...clip,
        id: makeId(),
        assetId: undefined,
        trimIn,
        sourceDuration: clip.sourceDuration ?? trimIn + clip.duration,
        uri: stem.url,
        label: stem.name,
        source: trackType === 'voiceover' ? 'voiceover' : 'imported',
      },
    };
  });
}

/**
 * 🎚️ V5: a telefonos szétválasztás (ének + kíséret) parancsai — két új, szabad aux sávra (a meglévő sávok
 * klipjeit nem fedi), az eredeti klip vágásával; a forrásfájlhoz kötött mezők (hangszer-minta, hangolás,
 * take-ek, asset) nélkül; az eredeti elnémítva. Egy kötegben → egy undo. `null`, ha nincs két szabad aux sáv.
 */
export function onDeviceStemCommands(
  project: Project,
  clip: AudioClip,
  stems: { vocalsUri: string; accompanimentUri: string },
  names: { vocals: string; accompaniment: string },
  makeId: (prefix: string) => string
): EditorCommand[] | null {
  const AUX: readonly TrackType[] = ['aux1', 'aux2', 'aux3', 'aux4', 'aux5'];
  const free = AUX.filter((t) => !project.tracks.some((tr) => tr.type === t));
  if (free.length < 2) return null;
  const trimIn = clip.trimIn ?? 0;
  const base: AudioClip = { ...clip, trimIn, sourceDuration: clip.sourceDuration ?? trimIn + clip.duration, source: 'imported' };
  delete base.instrumentDocId;
  delete base.tune;
  delete base.takes;
  delete base.activeTake;
  delete base.assetId;
  const out: EditorCommand[] = [];
  const parts: [TrackType, string, string][] = [
    [free[0], stems.vocalsUri, names.vocals],
    [free[1], stems.accompanimentUri, names.accompaniment],
  ];
  for (const [type, uri, name] of parts) {
    out.push({ type: 'ADD_TRACK', track: { id: makeId('trk'), type, name, clips: [] } });
    out.push({ type: 'ADD_CLIP', trackType: type, clip: { ...base, id: makeId('clip'), uri, label: name } });
  }
  out.push({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { volume: 0 } });
  return out;
}
