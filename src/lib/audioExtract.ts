import type { EditorCommand } from '@/lib/commands';
import { makeId } from '@/lib/id';
import { mergeLinkGroup } from '@/lib/linkGroups';
import type { AudioClip, VideoClip } from '@/types/project';

/**
 * 🎬→🎧 Videóklip hangjának LEVÁLASZTÁSA (detach) — nem-destruktívan.
 *
 * Egy külön `AudioClip`-et teszünk a `voiceover` sávra (a videóklip URI-jára
 * hivatkozva), és a videóklipet ELNÉMÍTJUK (volume 0). Így a hang a közös hang-
 * stúdióban teljes fegyverzettel szerkeszthető, a videó képe érintetlen, és a
 * lépés EGY undo (applyBatch). A hang és a kép link-csoportba kerül, így együtt mozognak.
 *
 * A leválasztott `AudioClip` átveszi a videóklip `trimIn`/`sourceDuration`-jét, így
 * a TRIMMELT klip hangja is korrekt (a render `atrim`-mel honorálja). ⏩⏪ A sebesség és az
 * irány is átjön (`AudioClip.speed` / `reversed`, hangmagasság-tartással): az előnézet 0,5–2×
 * között a lejátszóval gyorsít, azon kívül és visszafelé az előre nyújtott szakaszt játssza.
 */
export function canDetachAudio(clip: VideoClip): boolean {
  return clip.kind === 'video' && (clip.speed || 1) > 0 && clip.volume > 0;
}

export function detachAudioCommands(
  clip: VideoClip,
  label: string,
  links?: string[][]
): { audioClip: AudioClip; commands: EditorCommand[] } {
  const audioClip: AudioClip = {
    id: makeId('clip'),
    kind: 'audio',
    start: clip.start,
    duration: clip.duration,
    trimIn: clip.trimIn,
    sourceDuration: clip.sourceDuration,
    ...((clip.speed || 1) !== 1 ? { speed: clip.speed } : {}),
    ...(clip.reversed ? { reversed: true } : {}),
    uri: clip.uri,
    label,
    volume: clip.volume,
    fadeIn: clip.fadeInSec ?? 0,
    fadeOut: clip.fadeOutSec ?? 0,
    source: 'voiceover',
    voiceEnhance: clip.voiceEnhance,
    deReverb: clip.deReverb,
  };
  const commands: EditorCommand[] = [
    { type: 'ADD_CLIP', trackType: 'voiceover', clip: audioClip },
    // a videóklip elnémul (a hangot mostantól a leválasztott AudioClip viszi)
    { type: 'UPDATE_CLIP', clipId: clip.id, patch: { volume: 0 } },
    // A44: a hang a képpel együtt mozog (link-csoport), különben szétcsúszik a szinkron
    { type: 'SET_LINKS', links: mergeLinkGroup(links, [clip.id, audioClip.id]) },
  ];
  return { audioClip, commands };
}
