import type { AudioClip, TrackType } from '@/types/project';

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
