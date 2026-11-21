import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, Text, View } from 'react-native';

import { styles } from '@/components/editor/panels/sticker/stickerStyles';
import { PanelSection } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { logCaught } from '@/lib/logCaught';
import type { StickerShape } from '@/lib/stickerPanelOps';

export interface StickerShapesSectionProps {
  addShape: (shape: StickerShape) => void;
  addLogo: () => Promise<void>;
}

/** formák (téglalap, ellipszis, vonal, nyíl, csillag) + logó/kép beszúrása */
export function StickerShapesSection({ addShape, addLogo }: StickerShapesSectionProps) {
  const { t } = useTranslation();
  return (
    <PanelSection title={t('panels.sticker.shapesTitle')}>
      <View style={styles.shapeRow}>
        <Pressable style={styles.shapeCell} onPress={() => addShape('rectangle')}>
          <View style={styles.shapeRect} />
          <Text style={styles.shapeLabel}>{t('panels.sticker.shapeRectangle')}</Text>
        </Pressable>
        <Pressable style={styles.shapeCell} onPress={() => addShape('ellipse')}>
          <View style={styles.shapeEllipse} />
          <Text style={styles.shapeLabel}>{t('panels.sticker.shapeEllipse')}</Text>
        </Pressable>
        <Pressable style={styles.shapeCell} onPress={() => addShape('line')}>
          <View style={styles.shapeLine} />
          <Text style={styles.shapeLabel}>{t('panels.sticker.shapeLine')}</Text>
        </Pressable>
        <Pressable style={styles.shapeCell} onPress={() => addShape('arrow')}>
          <Text style={styles.shapeGlyph}>➜</Text>
          <Text style={styles.shapeLabel}>{t('panels.sticker.shapeArrow')}</Text>
        </Pressable>
        <Pressable style={styles.shapeCell} onPress={() => addShape('star')}>
          <Text style={styles.shapeGlyph}>★</Text>
          <Text style={styles.shapeLabel}>{t('panels.sticker.shapeStar')}</Text>
        </Pressable>
        <Pressable
          style={styles.shapeCell}
          onPress={() => {
            addLogo().catch((caught) =>
              { logCaught('components/editor/panels/StickerPanel.tsx:StickerPanel', caught); return Alert.alert(t('panels.sticker.logoName'), t('panels.sticker.logoLoadFailed')); }
            );
          }}
        >
          <Ionicons name="image-outline" size={26} color={palette.textDim} />
          <Text style={styles.shapeLabel}>{t('panels.sticker.shapeLogo')}</Text>
        </Pressable>
      </View>
      <Text style={styles.note}>
        {t('panels.sticker.shapesNote')}
      </Text>
    </PanelSection>
  );
}
