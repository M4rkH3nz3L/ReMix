import { StyleSheet, Text, View } from 'react-native';

import { Chip, ColorDot, PanelSection, Stepper } from '@/components/ui/controls';
import { palette, textColors } from '@/constants/editor';
import { clamp } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { BlendMode, ImageClip, PipFrame, VideoClip } from '@/types/project';

/** lekerekítés-presetek (a rövidebb él arányában) */
const RADII: { label: string; value: number }[] = [
  { label: 'Szögletes', value: 0 },
  { label: 'Lekerekített', value: 0.12 },
  { label: 'Nagyon kerek', value: 0.28 },
  { label: '🔵 Kör', value: 0.5 },
];

/** keverési módok a fő videóval (light-leak/overlay/dupla-expozíció) */
const BLENDS: { label: string; value: BlendMode }[] = [
  { label: '☀️ Screen', value: 'screen' },
  { label: '🌑 Multiply', value: 'multiply' },
  { label: '🎛️ Overlay', value: 'overlay' },
  { label: '⬆️ Lighten', value: 'lighten' },
];

/**
 * PiP-keret panel („webcam-bubble"): a pip-sávos klip lekerekítése + kerete +
 * árnyéka. A keret BELÜL van (a render pad-jével egyezik), a lekerekítés a
 * renderben `geq` alfával, az előnézetben natív borderRadius-szal — WYSIWYG.
 */
export function PipPanel({ clip }: { clip: VideoClip | ImageClip }) {
  const updateClip = useEditorStore((s) => s.updateClip);
  const frame = clip.pipFrame ?? {};
  const radius = frame.radius ?? 0;
  const borderWidth = frame.borderWidth ?? 0;
  const borderColor = frame.borderColor ?? '#ffffff';
  const shadow = frame.shadow ?? false;

  const patch = (next: Partial<PipFrame>) =>
    updateClip(clip.id, { pipFrame: { ...frame, ...next } });

  return (
    <View>
      <PanelSection title="Sarok-lekerekítés">
        <View style={styles.row}>
          {RADII.map((r) => (
            <Chip
              key={r.label}
              label={r.label}
              active={Math.abs(radius - r.value) < 0.02}
              onPress={() => patch({ radius: r.value })}
            />
          ))}
        </View>
        <Text style={styles.note}>
          A „🔵 Kör” nagyjából négyzetes PiP-en ad teljes kört — állítsd a PiP
          méretét közel négyzetesre a webcam-buborékhoz.
        </Text>
      </PanelSection>

      <PanelSection title="Keret">
        <Stepper
          label="Vastagság"
          value={`${Math.round(borderWidth * 1000) / 10}%`}
          onDec={() => patch({ borderWidth: clamp(borderWidth - 0.004, 0, 0.03) })}
          onInc={() => patch({ borderWidth: clamp(borderWidth + 0.004, 0, 0.03) })}
        />
        <View style={styles.row}>
          {textColors.map((color) => (
            <ColorDot
              key={color}
              color={color}
              active={borderColor.toLowerCase() === color.toLowerCase()}
              onPress={() => patch({ borderColor: color })}
            />
          ))}
        </View>
      </PanelSection>

      <PanelSection title="Keverés a fő videóval (blend)">
        <View style={styles.row}>
          <Chip
            label="Nincs"
            active={!frame.blendMode}
            onPress={() => patch({ blendMode: undefined })}
          />
          {BLENDS.map((b) => (
            <Chip
              key={b.value}
              label={b.label}
              active={frame.blendMode === b.value}
              onPress={() => patch({ blendMode: b.value })}
            />
          ))}
        </View>
        <Text style={styles.note}>
          A PiP a fő videóval keveredik (nem takarja): ☀️ Screen = világos rész
          átüt (light-leak, tűzijáték, fény-overlay), 🌑 Multiply = sötét rész
          átüt, Overlay/Lighten = kontraszt/dupla-expozíció. Előnézetben és
          renderben is beég.
        </Text>
      </PanelSection>

      <PanelSection title="Árnyék">
        <View style={styles.row}>
          <Chip label="Nincs" active={!shadow} onPress={() => patch({ shadow: false })} />
          <Chip label="🌒 Vetett árnyék" active={shadow} onPress={() => patch({ shadow: true })} />
        </View>
        <Text style={styles.note}>
          Lágy vetett árnyék a buborék mögé — az előnézetben és a renderelt
          videóban is (jobbra-le eltolva, elmosva).
        </Text>
      </PanelSection>

      {clip.pipFrame ? (
        <Chip
          label="Alaphelyzet"
          active={false}
          onPress={() => updateClip(clip.id, { pipFrame: undefined })}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
  },
});
