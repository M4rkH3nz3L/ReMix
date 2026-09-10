import { StyleSheet, Text, View } from 'react-native';

import { Chip, ColorDot, PanelSection, Stepper } from '@/components/ui/controls';
import { palette, textColors } from '@/constants/editor';
import { clamp } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { ShapeClip } from '@/types/project';

const GRADIENTS: { label: string; from: string; to: string }[] = [
  { label: 'Lila–pink', from: '#7c5cff', to: '#ff5ca8' },
  { label: 'Kék–türkiz', from: '#4d9dff', to: '#5cffd0' },
  { label: 'Naplemente', from: '#ff6b4a', to: '#ffb85c' },
];

/** Forma-szerkesztő (Creative Canvas): kitöltés, gradiens, keret, lekerekítés. */
const GLOW_PRESETS = [
  { label: '🩵 Cián', color: '#00e5ff' },
  { label: '💗 Pink', color: '#ff2d95' },
  { label: '🤍 Fehér', color: '#ffffff' },
  { label: '💛 Arany', color: '#ffd166' },
];

const OUTLINE_PRESETS = [
  { label: '🤍 Fehér', color: '#ffffff' },
  { label: '🖤 Fekete', color: '#0b0b18' },
  { label: '💗 Pink', color: '#ff2d95' },
];

export function ShapePanel({ clip }: { clip: ShapeClip }) {
  const updateClip = useEditorStore((s) => s.updateClip);
  const snapGrid = useEditorStore((s) => s.snapGrid);
  const setSnapGrid = useEditorStore((s) => s.setSnapGrid);

  return (
    <View>
      <PanelSection title="Forma">
        <View style={styles.row}>
          {(
            [
              { id: 'rectangle', label: 'Téglalap' },
              { id: 'ellipse', label: 'Ellipszis' },
              { id: 'line', label: 'Vonal' },
            ] as const
          ).map((s) => (
            <Chip
              key={s.id}
              label={s.label}
              active={clip.shape === s.id}
              onPress={() => updateClip(clip.id, { shape: s.id })}
            />
          ))}
        </View>
      </PanelSection>

      {clip.imageUri ? (
        <PanelSection title="Kép">
          <Text style={styles.note}>
            Kép-kitöltésű réteg (logó/watermark) — a méret, lekerekítés, keret és
            átlátszóság lent állítható; a képarányt a kép tartja (contain).
          </Text>
        </PanelSection>
      ) : (
        <PanelSection title="Kitöltés">
          <View style={styles.row}>
            {textColors.map((color) => (
              <ColorDot
                key={color}
                color={color}
                active={!clip.fillGradient && clip.fill === color}
                onPress={() =>
                  updateClip(clip.id, { fill: color, fillGradient: undefined })
                }
              />
            ))}
          </View>
          <View style={styles.row}>
            {GRADIENTS.map((g) => (
              <Chip
                key={g.label}
                label={g.label}
                active={clip.fillGradient?.from === g.from}
                onPress={() =>
                  updateClip(clip.id, { fillGradient: { from: g.from, to: g.to } })
                }
              />
            ))}
            {clip.fillGradient ? (
              <Chip
                label="✕ Sima szín"
                active={false}
                onPress={() => updateClip(clip.id, { fillGradient: undefined })}
              />
            ) : null}
          </View>
        </PanelSection>
      )}

      <PanelSection title="Blend">
        <View style={styles.row}>
          {(
            [
              { id: undefined, label: 'Normál' },
              { id: 'multiply', label: 'Szorzás' },
              { id: 'screen', label: 'Screen' },
              { id: 'overlay', label: 'Overlay' },
              { id: 'lighten', label: 'Világosít' },
              { id: 'difference', label: 'Különbség' },
            ] as const
          ).map((m) => (
            <Chip
              key={m.label}
              label={m.label}
              active={clip.blendMode === m.id}
              onPress={() => updateClip(clip.id, { blendMode: m.id })}
            />
          ))}
        </View>
        <Text style={styles.note}>
          A réteg az alatta lévő videóval keveredik — előnézetben és renderben is.
        </Text>
      </PanelSection>

      <PanelSection title="Méret és stílus">
        <Stepper
          label="Szélesség"
          value={`${Math.round(clip.w * 100)}%`}
          onDec={() => updateClip(clip.id, { w: clamp(clip.w - 0.05, 0.05, 1) })}
          onInc={() => updateClip(clip.id, { w: clamp(clip.w + 0.05, 0.05, 1) })}
        />
        <Stepper
          label="Magasság"
          value={`${Math.round(clip.h * 100)}%`}
          onDec={() =>
            updateClip(clip.id, { h: clamp(clip.h - 0.05, 0.004, 1) })
          }
          onInc={() => updateClip(clip.id, { h: clamp(clip.h + 0.05, 0.004, 1) })}
        />
        {clip.shape === 'rectangle' ? (
          <Stepper
            label="Lekerekítés"
            value={`${Math.round((clip.cornerRadius ?? 0) * 100)}%`}
            onDec={() =>
              updateClip(clip.id, {
                cornerRadius: clamp((clip.cornerRadius ?? 0) - 0.05, 0, 0.5),
              })
            }
            onInc={() =>
              updateClip(clip.id, {
                cornerRadius: clamp((clip.cornerRadius ?? 0) + 0.05, 0, 0.5),
              })
            }
          />
        ) : null}
        <Stepper
          label="Keret"
          value={`${(clip.borderWidth ?? 0).toFixed(1)}`}
          onDec={() =>
            updateClip(clip.id, {
              borderWidth: clamp((clip.borderWidth ?? 0) - 0.2, 0, 2),
              borderColor: clip.borderColor ?? '#ffffff',
            })
          }
          onInc={() =>
            updateClip(clip.id, {
              borderWidth: clamp((clip.borderWidth ?? 0) + 0.2, 0, 2),
              borderColor: clip.borderColor ?? '#ffffff',
            })
          }
        />
        <Stepper
          label="Átlátszóság"
          value={`${Math.round((clip.opacity ?? 1) * 100)}%`}
          onDec={() =>
            updateClip(clip.id, { opacity: clamp((clip.opacity ?? 1) - 0.1, 0.1, 1) })
          }
          onInc={() =>
            updateClip(clip.id, { opacity: clamp((clip.opacity ?? 1) + 0.1, 0.1, 1) })
          }
        />
        <View style={styles.row}>
          <Chip
            label={clip.shadow ? '🌒 Árnyék be' : '🌒 Árnyék'}
            active={clip.shadow === true}
            onPress={() => updateClip(clip.id, { shadow: !clip.shadow })}
          />
        </View>
        <Text style={styles.note}>
          A formát a vásznon húzással pozicionálhatod — a renderelt videóba
          pontosan így ég be. Az árnyék a renderben a forma sziluettjét követi
          (nyílon és csillagon is).
        </Text>
      </PanelSection>
      <PanelSection title="📐 Igazítás">
        <View style={styles.row}>
          {[
            { v: 0, label: 'Rács ki' },
            { v: 6, label: '6×6' },
            { v: 12, label: '12×12' },
          ].map((g) => (
            <Chip
              key={g.v}
              label={g.label}
              active={snapGrid === g.v}
              onPress={() => setSnapGrid(g.v)}
            />
          ))}
        </View>
        <Text style={styles.note}>
          Húzáskor a réteg a vászon közép- és harmadvonalaira, a safe-zone
          határokra, a TÖBBI RÉTEG középvonalára és a köztük lévő egyenlő
          térközre is ráugrik — a rács ehhez még egy egyenletes osztást ad.
        </Text>
      </PanelSection>

      <PanelSection title="✨ Ragyogás és kontúr">
        <Text style={styles.subLabel}>Ragyogás</Text>
        <View style={styles.row}>
          <Chip
            label="Nincs"
            active={!clip.glow}
            onPress={() => updateClip(clip.id, { glow: undefined })}
          />
          {GLOW_PRESETS.map((g) => (
            <Chip
              key={g.label}
              label={g.label}
              active={clip.glow?.color === g.color}
              onPress={() => updateClip(clip.id, { glow: { color: g.color, size: 2 } })}
            />
          ))}
        </View>
        {clip.glow ? (
          <Stepper
            label="Ragyogás mérete"
            value={`${clip.glow.size.toFixed(1)}%`}
            onDec={() =>
              updateClip(clip.id, {
                glow: { ...clip.glow!, size: clamp(clip.glow!.size - 0.4, 0.4, 6) },
              })
            }
            onInc={() =>
              updateClip(clip.id, {
                glow: { ...clip.glow!, size: clamp(clip.glow!.size + 0.4, 0.4, 6) },
              })
            }
          />
        ) : null}
        <Text style={styles.subLabel}>Kontúr</Text>
        <View style={styles.row}>
          <Chip
            label="Nincs"
            active={!clip.outline}
            onPress={() => updateClip(clip.id, { outline: undefined })}
          />
          {OUTLINE_PRESETS.map((o) => (
            <Chip
              key={o.label}
              label={o.label}
              active={clip.outline?.color === o.color}
              onPress={() => updateClip(clip.id, { outline: { color: o.color, width: 0.4 } })}
            />
          ))}
        </View>
        {clip.outline ? (
          <Stepper
            label="Kontúr vastagsága"
            value={`${clip.outline.width.toFixed(2)}%`}
            onDec={() =>
              updateClip(clip.id, {
                outline: { ...clip.outline!, width: clamp(clip.outline!.width - 0.1, 0.1, 2) },
              })
            }
            onInc={() =>
              updateClip(clip.id, {
                outline: { ...clip.outline!, width: clamp(clip.outline!.width + 0.1, 0.1, 2) },
              })
            }
          />
        ) : null}
        <Text style={styles.note}>
          Mindkettő a forma SZILUETTJÉT követi, ezért a nyílon, a csillagon és a
          kép-kitöltésű logón is működik — ott, ahol a sima keret nem. A
          renderben látszik pontosan; az előnézet közelít.
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
    alignItems: 'center',
  },
  subLabel: {
    color: palette.textDim,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 10,
    marginBottom: 4,
  },
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
  },
});
