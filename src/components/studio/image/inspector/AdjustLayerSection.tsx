import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { Chip } from '@/components/ui/controls';
import { Slider } from '@/components/studio/audio/primitives';
import { updateLayer } from '@/lib/imageDoc';
import { GRADES as GRADE_PRESETS } from '@/constants/grades';
import type { AdjustmentImageLayer, GradeId, ImageDoc } from '@/types/project';

import { inspectorStyles as styles } from './inspectorStyles';

/** 🎚️ korrekció-réteg: grade + globális adjust + HSL-lap */
export function AdjustLayerSection({
  doc,
  layer,
  commit,
  onOpenAdjust,
}: {
  doc: ImageDoc;
  layer: AdjustmentImageLayer;
  commit: (next: ImageDoc, label?: string) => void;
  onOpenAdjust: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {/* 🎚️ korrekció-réteg: grade + globális adjust (az ALATTA lévő kompozitra hat); a maszk-szekció alább él */}
      <Text maxFontSizeMultiplier={1.3} style={styles.sectionLabel}>{t('studio.image.filmLook', { defaultValue: 'Filmes look' })}</Text>
      <View style={styles.chipRow}>
        {GRADE_PRESETS.map((g) => (
          <Chip
            key={g.id}
            label={t(g.label, { defaultValue: g.id })}
            active={(layer.grade ?? 'none') === g.id}
            onPress={() => commit(updateLayer<AdjustmentImageLayer>(doc, layer.id, { grade: g.id === 'none' ? undefined : (g.id as GradeId) }))}
          />
        ))}
      </View>
      <Slider label={t('panels.adjust.adjust_exposure', { defaultValue: 'Expozíció' })} value={layer.adjust?.exposure ?? 0} min={-1} max={1} onChange={(v) => commit(updateLayer<AdjustmentImageLayer>(doc, layer.id, { adjust: { ...layer.adjust, exposure: v } }))} format={(v) => v.toFixed(2)} />
      <Slider label={t('panels.adjust.adjust_contrast', { defaultValue: 'Kontraszt' })} value={layer.adjust?.contrast ?? 0} min={-0.4} max={0.4} onChange={(v) => commit(updateLayer<AdjustmentImageLayer>(doc, layer.id, { adjust: { ...layer.adjust, contrast: v } }))} format={(v) => v.toFixed(2)} />
      <Slider label={t('panels.adjust.adjust_saturation', { defaultValue: 'Telítettség' })} value={layer.adjust?.saturation ?? 0} min={-1} max={1} onChange={(v) => commit(updateLayer<AdjustmentImageLayer>(doc, layer.id, { adjust: { ...layer.adjust, saturation: v } }))} format={(v) => v.toFixed(2)} />
      <View style={styles.chipRow}>
        <Chip label={t('studio.image.hsl.title')} active={!!layer.hsl} onPress={onOpenAdjust} />
      </View>
      <Text maxFontSizeMultiplier={1.3} style={styles.hintText}>{t('studio.image.adjustLayerHint', { defaultValue: 'A korrekció az ALATTA lévő rétegekre hat. Alább maszkolható.' })}</Text>
    </>
  );
}
