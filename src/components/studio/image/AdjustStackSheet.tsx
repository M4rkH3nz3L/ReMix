import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Chip } from '@/components/ui/controls';
import { Slider } from '@/components/studio/audio/primitives';
import { StudioSheet } from '@/components/studio/image/StudioSheet';
import { palette } from '@/constants/editor';
import {
  addAdjustment,
  createAdjustment,
  duplicateAdjustment,
  flattenAdjustments,
  isNeutralAdjust,
  removeAdjustment,
  reorderAdjustment,
  setAmount,
  toggleAdjustment,
  updateAdjustment,
} from '@/lib/adjustmentStack';
import { updateLayer } from '@/lib/imageDoc';
import type { AdjustmentKind, AdjustmentLayer, ClipAdjust, FilterId, ImageDoc, PhotoLayer } from '@/types/project';

const FILTERS: FilterId[] = ['none', 'warm', 'cool', 'mono', 'vivid', 'fade', 'night', 'retro', 'sunset', 'forest'];

/** egy skalár ClipAdjust-mező szerkesztő-metaadata (tartomány + címke) */
type Field = keyof ClipAdjust;
const FIELD_META: Partial<Record<Field, { min: number; max: number; labelKey: string }>> = {
  exposure: { min: -1, max: 1, labelKey: 'panels.adjust.adjust_exposure' },
  contrast: { min: -0.4, max: 0.4, labelKey: 'panels.adjust.adjust_contrast' },
  temperature: { min: -0.3, max: 0.3, labelKey: 'panels.adjust.adjust_temperature' },
  tint: { min: -0.3, max: 0.3, labelKey: 'panels.adjust.adjust_tint' },
  saturation: { min: -1, max: 1, labelKey: 'panels.adjust.adjust_saturation' },
  vibrance: { min: -1, max: 1, labelKey: 'panels.adjust.adjust_vibrance' },
  highlights: { min: -1, max: 1, labelKey: 'panels.adjust.adjust_highlights' },
  shadows: { min: -1, max: 1, labelKey: 'panels.adjust.adjust_shadows' },
  whites: { min: -1, max: 1, labelKey: 'panels.adjust.adjust_whites' },
  blacks: { min: -1, max: 1, labelKey: 'panels.adjust.adjust_blacks' },
  vignette: { min: 0, max: 1, labelKey: 'panels.adjust.adjust_vignette' },
};
/** a kártya a csúszkákat EBBEN a sorrendben rajzolja (a réteg adjust-jában jelenlévőket) */
const FIELD_ORDER: Field[] = [
  'exposure', 'contrast', 'temperature', 'tint', 'highlights', 'shadows', 'whites', 'blacks', 'saturation', 'vibrance', 'vignette',
];

/** a „korrekció hozzáadása" bejegyzések — a seed-mezők 0-ként kerülnek be (csúszka jelenik meg, de render-semleges) */
interface AddEntry {
  id: string;
  kind: AdjustmentKind;
  seed: ClipAdjust;
  icon: keyof typeof Ionicons.glyphMap;
  nameKey: string;
}
const ADD_ENTRIES: AddEntry[] = [
  { id: 'exposure', kind: 'exposure', seed: { exposure: 0 }, icon: 'sunny-outline', nameKey: 'studio.image.adjustStack.kind.exposure' },
  { id: 'contrast', kind: 'contrast', seed: { contrast: 0 }, icon: 'contrast-outline', nameKey: 'studio.image.adjustStack.kind.contrast' },
  { id: 'whiteBalance', kind: 'whiteBalance', seed: { temperature: 0, tint: 0 }, icon: 'thermometer-outline', nameKey: 'studio.image.adjustStack.kind.whiteBalance' },
  { id: 'tone', kind: 'custom', seed: { highlights: 0, shadows: 0, whites: 0, blacks: 0 }, icon: 'sunny', nameKey: 'studio.image.adjustStack.kind.tone' },
  { id: 'saturation', kind: 'saturation', seed: { saturation: 0 }, icon: 'color-palette-outline', nameKey: 'studio.image.adjustStack.kind.saturation' },
  { id: 'vibrance', kind: 'vibrance', seed: { vibrance: 0 }, icon: 'color-filter-outline', nameKey: 'studio.image.adjustStack.kind.vibrance' },
  { id: 'vignette', kind: 'vignette', seed: { vignette: 0 }, icon: 'ellipse-outline', nameKey: 'studio.image.adjustStack.kind.vignette' },
];

const KIND_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  exposure: 'sunny-outline',
  contrast: 'contrast-outline',
  whiteBalance: 'thermometer-outline',
  saturation: 'color-palette-outline',
  vibrance: 'color-filter-outline',
  vignette: 'ellipse-outline',
  custom: 'sunny',
};

/**
 * 🎚️ Non-destruktív KORREKCIÓS-VEREM szerkesztő (érintő-first) — a fotó
 * `adjustmentStack`-je a forrás-igazság, amit minden változáskor a `flattenAdjustments`
 * a `adjust`-ba laposít (a preview + worker render-láncát NEM kell átírni). Szűrő-sor
 * (gyors preset) + „korrekció hozzáadása" chipek + stack-kártyák (ki/be, sorrend,
 * duplázás, törlés, erősség + a jelenlévő mezők csúszkái). Minden a command-buson (undo).
 */
export function AdjustStackSheet({
  doc,
  layer,
  commit,
  onClose,
}: {
  doc: ImageDoc;
  layer: PhotoLayer;
  commit: (next: ImageDoc, label?: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  // a verem: a mentett stack, vagy ha nincs de van „örökölt" sima adjust → abból egy „Alap" réteg
  const stack: AdjustmentLayer[] =
    layer.adjustmentStack ??
    (layer.adjust && !isNeutralAdjust(layer.adjust)
      ? [createAdjustment('custom', layer.adjust, t('studio.image.adjustStack.base'))]
      : []);

  const commitStack = (next: AdjustmentLayer[]) =>
    commit(
      updateLayer<PhotoLayer>(doc, layer.id, { adjustmentStack: next, adjust: flattenAdjustments(next) }),
      'adjust-stack'
    );

  return (
    <StudioSheet
      title={t('studio.image.adjustStack.title')}
      icon="options-outline"
      onClose={onClose}
      footer={
        stack.length > 0 ? (
          <Pressable
            style={styles.reset}
            onPress={() =>
              commit(
                updateLayer<PhotoLayer>(doc, layer.id, { adjustmentStack: [], adjust: undefined }),
                'adjust-reset'
              )
            }
          >
            <Ionicons name="refresh-outline" size={15} color={palette.text} />
            <Text style={styles.resetText}>{t('studio.image.adjustStack.reset')}</Text>
          </Pressable>
        ) : undefined
      }
    >
      {/* 🎨 szűrők (gyors preset — a stacktől független filterId) */}
      <Text style={styles.section}>{t('studio.image.filter')}</Text>
      <View style={styles.chipRow}>
        {FILTERS.map((f) => (
          <Chip
            key={f}
            label={t(`editor.filter.${f}`)}
            active={(layer.filterId ?? 'none') === f}
            onPress={() =>
              commit(
                updateLayer<PhotoLayer>(doc, layer.id, {
                  filterId: f,
                  filterIntensity: layer.filterIntensity ?? 1,
                }),
                'filter'
              )
            }
          />
        ))}
      </View>

      {/* ➕ korrekció hozzáadása */}
      <Text style={styles.section}>{t('studio.image.adjustStack.add')}</Text>
      <View style={styles.chipRow}>
        {ADD_ENTRIES.map((e) => (
          <Pressable
            key={e.id}
            style={styles.addChip}
            onPress={() => commitStack(addAdjustment(stack, createAdjustment(e.kind, { ...e.seed }, t(e.nameKey))))}
          >
            <Ionicons name={e.icon} size={15} color={palette.accent} />
            <Text style={styles.addChipText}>{t(e.nameKey)}</Text>
          </Pressable>
        ))}
      </View>

      {/* 🗂️ a verem (fölül a legfölső réteg) */}
      {stack.length === 0 ? (
        <Text style={styles.empty}>{t('studio.image.adjustStack.empty')}</Text>
      ) : (
        <View style={{ gap: 10 }}>
          {[...stack]
            .map((l, i) => ({ l, i }))
            .reverse()
            .map(({ l, i }) => {
              const fields = FIELD_ORDER.filter((f) => Object.prototype.hasOwnProperty.call(l.adjust, f));
              return (
                <View key={l.id} style={[styles.card, !l.enabled ? styles.cardOff : null]}>
                  <View style={styles.cardHead}>
                    <Ionicons name={KIND_ICON[l.kind] ?? 'options-outline'} size={16} color={palette.accent} />
                    <Text style={styles.cardName} numberOfLines={1}>
                      {l.name}
                    </Text>
                    <IconBtn
                      icon={l.enabled ? 'eye-outline' : 'eye-off-outline'}
                      color={l.enabled ? palette.text : palette.textDim}
                      onPress={() => commitStack(toggleAdjustment(stack, l.id))}
                    />
                    <IconBtn
                      icon="chevron-up"
                      color={i < stack.length - 1 ? palette.textDim : palette.border}
                      onPress={() => commitStack(reorderAdjustment(stack, l.id, 1))}
                    />
                    <IconBtn
                      icon="chevron-down"
                      color={i > 0 ? palette.textDim : palette.border}
                      onPress={() => commitStack(reorderAdjustment(stack, l.id, -1))}
                    />
                    <IconBtn icon="copy-outline" onPress={() => commitStack(duplicateAdjustment(stack, l.id))} />
                    <IconBtn
                      icon="trash-outline"
                      color={palette.danger}
                      onPress={() => commitStack(removeAdjustment(stack, l.id))}
                    />
                  </View>

                  {fields.map((f) => {
                    const meta = FIELD_META[f]!;
                    return (
                      <Slider
                        key={String(f)}
                        label={t(meta.labelKey)}
                        value={(l.adjust[f] as number | undefined) ?? 0}
                        min={meta.min}
                        max={meta.max}
                        onChange={(v) =>
                          commitStack(updateAdjustment(stack, l.id, { adjust: { [f]: v } as ClipAdjust }))
                        }
                        format={(v) => v.toFixed(2)}
                      />
                    );
                  })}

                  <Slider
                    label={t('studio.image.adjustStack.amount')}
                    value={l.amount}
                    min={0}
                    max={1}
                    onChange={(v) => commitStack(setAmount(stack, l.id, v))}
                    format={(v) => `${Math.round(v * 100)}%`}
                  />
                </View>
              );
            })}
        </View>
      )}
    </StudioSheet>
  );
}

function IconBtn({
  icon,
  color = palette.textDim,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color?: string;
  onPress: () => void;
}) {
  return (
    <Pressable hitSlop={8} onPress={onPress} style={styles.iconBtn}>
      <Ionicons name={icon} size={17} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { color: palette.textDim, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  addChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: palette.surfaceHigh,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  addChipText: { color: palette.text, fontSize: 12, fontWeight: '700' },
  empty: { color: palette.textDim, fontSize: 12, textAlign: 'center', paddingVertical: 14 },
  card: {
    gap: 10,
    backgroundColor: palette.surfaceHigh,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 12,
  },
  cardOff: { opacity: 0.55 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardName: { flex: 1, color: palette.text, fontSize: 13, fontWeight: '800' },
  iconBtn: { padding: 3 },
  reset: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceHigh,
  },
  resetText: { color: palette.text, fontSize: 13, fontWeight: '700' },
});
