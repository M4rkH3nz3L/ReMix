import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { StudioSheet } from '@/components/studio/image/StudioSheet';
import { palette } from '@/constants/editor';
import type { BooleanOp } from '@/lib/boolean';
import { effectiveCanvas } from '@/lib/canvasPresets';
import { booleanCombineInDoc } from '@/lib/imageBoolean';
import { logCaught } from '@/lib/logCaught';
import type { ImageDoc } from '@/types/project';

const OPS: { op: BooleanOp; icon: keyof typeof Ionicons.glyphMap; labelKey: string }[] = [
  { op: 'union', icon: 'add-circle-outline', labelKey: 'studio.image.boolean.union' },
  { op: 'subtract', icon: 'remove-circle-outline', labelKey: 'studio.image.boolean.subtract' },
  { op: 'intersect', icon: 'ellipse-outline', labelKey: 'studio.image.boolean.intersect' },
  { op: 'exclude', icon: 'git-compare-outline', labelKey: 'studio.image.boolean.exclude' },
];

/**
 * 🔗 Boolean-lap (07 §2.6) — a kijelölt formát a hozzá legközelebbi MÁSIK formával
 * kombinálja (union/subtract/intersect/exclude) a `boolean` mag + `imageBoolean`
 * fölött. Az eredmény EGY path-forma, amit a subpaths-tudatos render megjelenít.
 */
export function BooleanSheet({
  doc,
  selectedId,
  commit,
  onResult,
  onClose,
}: {
  doc: ImageDoc;
  selectedId: string;
  commit: (next: ImageDoc, label?: string) => void;
  onResult: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const apply = async (op: BooleanOp) => {
    // a Skia-motor megtartja a görbéket; ha a natív modul hiányzik, a tiszta mag dolgozik
    const engine = await import('@/components/studio/image/skiaVector')
      .then((m) => m.skiaBooleanEngine(effectiveCanvas(doc)))
      .catch((caught: unknown) => {
        logCaught('components/studio/image/BooleanSheet.tsx:apply', caught);
        return undefined;
      });
    const out = booleanCombineInDoc(doc, selectedId, op, engine);
    if (!out) {
      Alert.alert(t('studio.image.boolean.title'), t('studio.image.boolean.empty'));
      return;
    }
    commit(out.doc, t('studio.image.boolean.title'));
    onResult(out.resultId);
    onClose();
  };
  return (
    <StudioSheet title={t('studio.image.boolean.title')} icon="git-merge" onClose={onClose}>
      <Text style={styles.hint}>{t('studio.image.boolean.hint')}</Text>
      <View style={styles.grid}>
        {OPS.map((o) => (
          <Pressable
            key={o.op}
            style={styles.btn}
            onPress={() => void apply(o.op)}
            accessibilityRole="button"
            accessibilityLabel={t(o.labelKey)}
          >
            <Ionicons name={o.icon} size={24} color={palette.text} />
            <Text style={styles.btnLabel}>{t(o.labelKey)}</Text>
          </Pressable>
        ))}
      </View>
    </StudioSheet>
  );
}

const styles = StyleSheet.create({
  hint: {
    color: palette.textDim,
    fontSize: 12,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
  },
  btn: {
    width: '48%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: palette.border,
  },
  btnLabel: {
    color: palette.text,
    fontSize: 12,
    fontWeight: '600',
  },
});
