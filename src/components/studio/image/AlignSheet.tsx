import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { StudioSheet } from '@/components/studio/image/StudioSheet';
import { palette } from '@/constants/editor';
import { alignLayerInDoc } from '@/lib/imageLayerLayout';
import type { AlignEdge } from '@/lib/layout';
import type { ImageDoc, ImageLayer } from '@/types/project';

const ROWS: { titleKey: string; items: { edge: AlignEdge; icon: keyof typeof Ionicons.glyphMap; labelKey: string }[] }[] = [
  {
    titleKey: 'studio.image.align.horizontal',
    items: [
      { edge: 'left', icon: 'arrow-back', labelKey: 'studio.image.align.left' },
      { edge: 'hcenter', icon: 'swap-horizontal', labelKey: 'studio.image.align.hcenter' },
      { edge: 'right', icon: 'arrow-forward', labelKey: 'studio.image.align.right' },
    ],
  },
  {
    titleKey: 'studio.image.align.vertical',
    items: [
      { edge: 'top', icon: 'arrow-up', labelKey: 'studio.image.align.top' },
      { edge: 'vcenter', icon: 'swap-vertical', labelKey: 'studio.image.align.vcenter' },
      { edge: 'bottom', icon: 'arrow-down', labelKey: 'studio.image.align.bottom' },
    ],
  },
];

/**
 * 🧲 Igazítás-lap (07 §2.7) — a kijelölt réteget a VÁSZONHOZ igazítja (bal/közép/
 * jobb · fent/közép/lent) a `layout` mag `alignRects`-ére építve (`imageLayerLayout`).
 * A réteg pozíciója változik → a vászon azonnal frissül (a render-cache ürül).
 */
export function AlignSheet({
  doc,
  layer,
  commit,
  onClose,
}: {
  doc: ImageDoc;
  layer: ImageLayer;
  commit: (next: ImageDoc, label?: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const align = (edge: AlignEdge) => {
    const next = alignLayerInDoc(doc, layer.id, edge);
    if (next !== doc) {
      commit(next, t('studio.image.align.title'));
    }
  };
  return (
    <StudioSheet title={t('studio.image.align.title')} icon="magnet" onClose={onClose}>
      <Text style={styles.hint}>{t('studio.image.align.hint')}</Text>
      {ROWS.map((row) => (
        <View key={row.titleKey} style={styles.group}>
          <Text style={styles.groupTitle}>{t(row.titleKey)}</Text>
          <View style={styles.row}>
            {row.items.map((it) => (
              <Pressable
                key={it.edge}
                style={styles.btn}
                onPress={() => align(it.edge)}
                accessibilityRole="button"
                accessibilityLabel={t(it.labelKey)}
              >
                <Ionicons name={it.icon} size={22} color={palette.text} />
                <Text style={styles.btnLabel}>{t(it.labelKey)}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
    </StudioSheet>
  );
}

const styles = StyleSheet.create({
  hint: {
    color: palette.textDim,
    fontSize: 12,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  group: {
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  groupTitle: {
    color: palette.textDim,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  btn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: palette.border,
  },
  btnLabel: {
    color: palette.text,
    fontSize: 11,
    fontWeight: '600',
  },
});
