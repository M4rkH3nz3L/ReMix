import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Chip } from '@/components/ui/controls';
import { FIELD_META } from '@/components/studio/image/AdjustStackSheet';
import { Slider } from '@/components/studio/audio/primitives';
import { palette } from '@/constants/editor';
import {
  addAdjustment,
  createAdjustment,
  flattenAdjustments,
  isNeutralAdjust,
  updateAdjustment,
} from '@/lib/adjustmentStack';
import { updateLayer } from '@/lib/imageDoc';
import type { AdjustmentLayer, ClipAdjust, ImageDoc, PhotoLayer } from '@/types/project';

/** a gyors-sáv paraméterei (a leggyakoribb fotó-korrekciók, gyakorisági sorrendben) */
const QUICK_FIELDS: (keyof ClipAdjust)[] = [
  'exposure',
  'contrast',
  'highlights',
  'shadows',
  'saturation',
  'vibrance',
  'temperature',
  'vignette',
];

/** a gyors-sáv SAJÁT rétege a korrekciós veremben — fix id, így a teljes lap is ugyanazt látja */
export const QUICK_ADJUST_ID = 'adj_quick';

/**
 * ⚡ Kép Stúdió gyors korrekció (MOBILE-UI §3.1, §6.6) — a vászon ALATT, az
 * eszköztár HELYÉN: paraméter-chipek + EGY csúszka. A kép nem zsugorodik és nincs
 * scrim → a fényerő/kontraszt húzásának hatása teljes méretben látszik.
 *
 * A non-destruktív korrekciós verem egy saját („Gyors") rétegét szerkeszti
 * (`QUICK_ADJUST_ID`); a „Részletek" a teljes verem-lapot nyitja, ahol ez a réteg is
 * ki/be kapcsolható, átrendezhető. Minden módosítás a command buson (undo).
 */
export function ImageAdjustStrip({
  doc,
  layer,
  commit,
  onDetails,
  onClose,
}: {
  doc: ImageDoc;
  layer: PhotoLayer;
  commit: (next: ImageDoc, label?: string) => void;
  onDetails: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [field, setField] = useState<keyof ClipAdjust>('exposure');
  const meta = FIELD_META[field] ?? { min: -1, max: 1, labelKey: '' };

  // a verem (mint a teljes lapon: örökölt sima adjust → „Alap" réteg)
  const stack: AdjustmentLayer[] =
    layer.adjustmentStack ??
    (layer.adjust && !isNeutralAdjust(layer.adjust)
      ? [createAdjustment('custom', layer.adjust, t('studio.image.adjustStack.base'))]
      : []);
  const quick = stack.find((l) => l.id === QUICK_ADJUST_ID);
  const value = (quick?.adjust[field] as number | undefined) ?? 0;

  const setValue = (v: number) => {
    const next = quick
      ? updateAdjustment(stack, QUICK_ADJUST_ID, { adjust: { [field]: v } as ClipAdjust })
      : addAdjustment(stack, {
          ...createAdjustment('custom', { [field]: v } as ClipAdjust, t('studio.image.adjustStack.quick')),
          id: QUICK_ADJUST_ID,
        });
    commit(
      updateLayer<PhotoLayer>(doc, layer.id, { adjustmentStack: next, adjust: flattenAdjustments(next) }),
      'adjust-stack'
    );
  };

  return (
    <View style={styles.strip}>
      <View style={styles.head}>
        <Ionicons name="contrast-outline" size={15} color={palette.accent} />
        <Text style={styles.title}>{t('studio.imageTools.adjust')}</Text>
        <Pressable
          onPress={onDetails}
          hitSlop={8}
          style={styles.details}
          accessibilityRole="button"
          accessibilityLabel={t('editor.panelHost.details')}
        >
          <Ionicons name="options-outline" size={14} color={palette.accent} />
          <Text style={styles.detailsText}>{t('editor.panelHost.details')}</Text>
        </Pressable>
        <Pressable
          onPress={onClose}
          hitSlop={10}
          style={styles.close}
          accessibilityRole="button"
          accessibilityLabel={t('common.done')}
        >
          <Ionicons name="checkmark" size={20} color={palette.text} />
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {QUICK_FIELDS.map((f) => {
          const m = FIELD_META[f];
          if (!m) {
            return null;
          }
          const changed = ((quick?.adjust[f] as number | undefined) ?? 0) !== 0;
          return (
            <Chip
              key={String(f)}
              label={`${t(m.labelKey)}${changed ? ' •' : ''}`}
              active={field === f}
              onPress={() => setField(f)}
            />
          );
        })}
      </ScrollView>
      <View style={styles.sliderRow}>
        <View style={styles.flex}>
          <Slider
            label={t(meta.labelKey)}
            value={value}
            min={meta.min}
            max={meta.max}
            onChange={setValue}
            format={(v) => (v > 0 ? `+${Math.round(v * 100)}` : `${Math.round(v * 100)}`)}
          />
        </View>
        <Pressable
          onPress={() => setValue(0)}
          disabled={value === 0}
          hitSlop={8}
          style={styles.reset}
          accessibilityRole="button"
          accessibilityLabel={t('studio.image.adjustStack.reset')}
        >
          <Ionicons name="refresh" size={16} color={value === 0 ? palette.border : palette.textDim} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    backgroundColor: palette.surface,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 8,
    gap: 6,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { color: palette.text, fontSize: 13, fontWeight: '700' },
  details: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 30,
    paddingHorizontal: 10,
    marginLeft: 'auto',
    borderRadius: 8,
    backgroundColor: palette.accentSoft,
  },
  detailsText: { color: palette.accent, fontSize: 12, fontWeight: '700' },
  close: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  chips: { gap: 8, paddingRight: 8 },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  reset: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
