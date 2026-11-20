import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { Chip } from '@/components/ui/controls';
import { updateLayer } from '@/lib/imageDoc';
import type { ImageDoc, ImageLayer } from '@/types/project';

import { inspectorStyles as styles } from './inspectorStyles';

/** 🎭 gradient-maszk (elhalványulás iránya) — minden rétegnél */
export function MaskFadeSection({
  doc,
  layer,
  commit,
}: {
  doc: ImageDoc;
  layer: ImageLayer;
  commit: (next: ImageDoc, label?: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {/* 🎭 gradient-maszk: a réteg a megadott irányba fokozatosan átlátszóvá fade-el (a render geq-vel) */}
      <Text maxFontSizeMultiplier={1.3} style={styles.sectionLabel}>{t('studio.image.maskFade', { defaultValue: 'Gradient-maszk (elhalványulás)' })}</Text>
      <View style={styles.chipRow}>
        {(['none', 'left', 'right', 'up', 'down'] as const).map((d) => (
          <Chip
            key={d}
            label={t(`studio.image.maskDir.${d}`, { defaultValue: d })}
            active={(layer.maskGradient ?? 'none') === d}
            onPress={() => commit(updateLayer(doc, layer.id, { maskGradient: d === 'none' ? undefined : d }))}
          />
        ))}
      </View>
    </>
  );
}
