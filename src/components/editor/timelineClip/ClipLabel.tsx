import { StyleSheet, Text } from 'react-native';

import { clipLabel } from '@/lib/timelineClipOps';
import type { Clip } from '@/types/project';
import type { TFunction } from 'i18next';

/**
 * 🏷️ A klip felirata: szöveg-klipen tömör, média-háttér (filmstrip/hullámforma)
 * fölött chipben, hangklipen és filmszalagos klipen kis sarok-címke.
 */
export function ClipLabel({
  clip,
  selected,
  color,
  mediaThumb,
  t,
}: {
  clip: Clip;
  selected: boolean;
  color: string;
  mediaThumb: boolean;
  t: TFunction;
}) {
  return (
    <Text
      numberOfLines={1}
      style={[
        styles.label,
        {
          color:
            selected || clip.kind === 'text' || clip.kind === 'audio'
              ? '#fff'
              : `${color}`,
        },
        // média-háttér (filmstrip/hullámforma) fölött chip tartja olvashatónak
        clip.kind !== 'text' && clip.kind !== 'interactive' ? styles.labelChip : null,
        // hangklipen a fájlnév kis címke a bal-felső sarokban — a
        // hullámforma marad a főszereplő (látványterv szerint)
        clip.kind === 'audio' ? styles.labelAudio : null,
        mediaThumb ? styles.labelMedia : null,
      ]}
    >
      {clipLabel(clip, t)}
    </Text>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 11,
    fontWeight: '600',
  },
  labelChip: {
    alignSelf: 'flex-start',
    backgroundColor: '#07080dcc',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  labelMedia: {
    position: 'absolute',
    top: 2,
    left: 4,
    fontSize: 9,
    fontWeight: '700',
    backgroundColor: '#07080d88',
  },
  labelAudio: {
    position: 'absolute',
    top: 2,
    left: 4,
    fontSize: 9,
    fontWeight: '700',
  },
});
