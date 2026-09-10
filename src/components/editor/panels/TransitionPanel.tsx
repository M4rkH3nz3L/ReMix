import { StyleSheet, Text, View } from 'react-native';

import { Chip, PanelSection, Stepper } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { clamp } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { ImageClip, TransitionOut, VideoClip } from '@/types/project';

const STEP = 0.25;
const MAX_FADE = 2;

const TRANSITIONS: { id: TransitionOut['type']; label: string }[] = [
  // 🧊 3D-jellegű
  { id: 'zoom', label: '🔍 Zoom-through' },
  { id: 'spin', label: '🌀 Pörgés' },
  { id: 'flip', label: '↕️ Billenés' },
  { id: 'cube', label: '🧊 Kocka' },
  { id: 'circle', label: '⭕ Kör' },
  { id: 'dissolve', label: '✨ Feloldás' },
  // 2D — wipe / csúszás
  { id: 'wipeLeft', label: '⬅️ Wipe balra' },
  { id: 'wipeRight', label: '➡️ Wipe jobbra' },
  { id: 'wipeUp', label: '⬆️ Wipe fel' },
  { id: 'wipeDown', label: '⬇️ Wipe le' },
  { id: 'slideLeft', label: '⏪ Csúszás balra' },
  { id: 'slideRight', label: '⏩ Csúszás jobbra' },
  // 2D — stílus
  { id: 'pixelize', label: '👾 Pixel (glitch)' },
  { id: 'blur', label: '🌫️ Elmosás' },
  { id: 'radial', label: '🕐 Radiális' },
  { id: 'fadeBlack', label: '🎬 Feketén át' },
  { id: 'fadeWhite', label: '⚪ Fehéren át' },
];

/** Áttűnés feketéből/feketébe a klip szélein — az egymás utáni klipek
 * kimenő+bejövő fade-je együtt adja a vágásponti átúszást. */
export function TransitionPanel({ clip }: { clip: VideoClip | ImageClip }) {
  const updateClip = useEditorStore((s) => s.updateClip);

  const fadeIn = clip.fadeInSec ?? 0;
  const fadeOut = clip.fadeOutSec ?? 0;
  const half = clip.duration / 2;

  return (
    <View>
      <PanelSection title="Áttűnés">
        <Stepper
          label="Bejövő (fade in)"
          value={fadeIn > 0 ? `${fadeIn.toFixed(2)} mp` : 'nincs'}
          onDec={() => updateClip(clip.id, { fadeInSec: clamp(fadeIn - STEP, 0, MAX_FADE) })}
          onInc={() =>
            updateClip(clip.id, { fadeInSec: clamp(fadeIn + STEP, 0, Math.min(MAX_FADE, half)) })
          }
        />
        <Stepper
          label="Kimenő (fade out)"
          value={fadeOut > 0 ? `${fadeOut.toFixed(2)} mp` : 'nincs'}
          onDec={() => updateClip(clip.id, { fadeOutSec: clamp(fadeOut - STEP, 0, MAX_FADE) })}
          onInc={() =>
            updateClip(clip.id, { fadeOutSec: clamp(fadeOut + STEP, 0, Math.min(MAX_FADE, half)) })
          }
        />
        <Text style={styles.note}>
          Ha az előző klip kimenő és a következő bejövő áttűnést is kap, a vágás
          lágy átúszásként hat.
        </Text>
      </PanelSection>

      <PanelSection title="🎬 Átmenet a következő klipre">
        <View style={styles.row}>
          <Chip
            label="Nincs"
            active={!clip.transitionOut}
            onPress={() => updateClip(clip.id, { transitionOut: undefined })}
          />
          {TRANSITIONS.map((t) => (
            <Chip
              key={t.id}
              label={t.label}
              active={clip.transitionOut?.type === t.id}
              onPress={() =>
                updateClip(clip.id, {
                  transitionOut: {
                    type: t.id,
                    duration: clip.transitionOut?.duration ?? 0.5,
                  },
                })
              }
            />
          ))}
        </View>
        {clip.transitionOut ? (
          <Stepper
            label="Hossz"
            value={`${clip.transitionOut.duration.toFixed(2)} mp`}
            onDec={() =>
              updateClip(clip.id, {
                transitionOut: {
                  ...clip.transitionOut!,
                  duration: clamp(clip.transitionOut!.duration - 0.1, 0.2, 1.5),
                },
              })
            }
            onInc={() =>
              updateClip(clip.id, {
                transitionOut: {
                  ...clip.transitionOut!,
                  duration: clamp(clip.transitionOut!.duration + 0.1, 0.2, 1.5),
                },
              })
            }
          />
        ) : null}
        <Text style={styles.note}>
          Az átmenet a klip végén indul és a következő klipbe visz át — a
          renderelt MP4-ben ég be (az előnézet vágásként mutatja), az időzítés
          nem csúszik el.
        </Text>
      </PanelSection>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
  },
});
