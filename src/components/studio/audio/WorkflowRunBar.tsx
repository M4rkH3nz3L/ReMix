import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { currentStep, finishCurrent, isRunComplete, runProgress } from '@/lib/workflowTemplate';
import { useEditorStore } from '@/store/editorStore';

/**
 * ▶️ Munkafolyamat-sáv (AUDIO-PROD C4 · SC7): a projekt futó munkafolyamatának (pl. Podcast-epizód) aktuális
 * lépése, a haladás, és mit kell tenni. „Kész” / „Kihagyás” = egy parancs (egy visszavonás); ahol a lépés
 * a képernyőről indítható (videóba küldés, export), ott „Indítás” is. A végén „Kész a munkafolyamat” + bezárás.
 */
export function WorkflowRunBar({ onStart }: { onStart?: (kind: string) => boolean }) {
  const { t } = useTranslation();
  const run = useEditorStore((s) => s.project?.workflowRun);
  if (!run) return null;
  const cur = currentStep(run);
  const p = runProgress(run);
  const set = (next: typeof run | null) => useEditorStore.getState().dispatch({ type: 'SET_WORKFLOW_RUN', run: next }, 'user');
  const now = () => new Date().toISOString();
  const startable = !!cur && !!onStart && ['clips', 'audiogram', 'publish'].includes(cur.kind);
  return (
    <View style={styles.bar} testID="workflow-bar" accessibilityRole="summary">
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1}>
          {t(`workflowTpl.name.${run.templateId}`, { defaultValue: run.name })} · {p.done + p.skipped}/{p.total}
          {cur ? ` · ${t(cur.label, { defaultValue: cur.id })}` : ''}
        </Text>
        <Text style={styles.hint} numberOfLines={2}>
          {cur ? t(`workflowTpl.hint.${cur.kind}`, { defaultValue: '' }) : isRunComplete(run) ? t('workflowTpl.done') : ''}
        </Text>
      </View>
      {startable ? (
        <Pressable style={[styles.btn, styles.primary]} onPress={() => onStart!(cur!.kind)} accessibilityRole="button" accessibilityLabel={t('workflowTpl.start')} testID="workflow-start">
          <Text style={styles.btnText}>{t('workflowTpl.start')}</Text>
        </Pressable>
      ) : null}
      {cur ? (
        <>
          <Pressable style={styles.btn} onPress={() => set(finishCurrent(run, 'skipped', now()))} accessibilityRole="button" accessibilityLabel={t('workflowTpl.skip')} testID="workflow-skip">
            <Text style={styles.btnText}>{t('workflowTpl.skip')}</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.primary]} onPress={() => set(finishCurrent(run, 'done', now()))} accessibilityRole="button" accessibilityLabel={t('workflowTpl.markDone')} testID="workflow-done">
            <Ionicons name="checkmark" size={16} color="#fff" />
          </Pressable>
        </>
      ) : null}
      <Pressable style={styles.btn} onPress={() => set(null)} accessibilityRole="button" accessibilityLabel={t('workflowTpl.close')} testID="workflow-close">
        <Ionicons name="close" size={16} color={palette.textDim} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: palette.surfaceHigh, borderBottomWidth: 1, borderBottomColor: palette.border },
  title: { color: palette.text, fontSize: 13, fontWeight: '800' },
  hint: { color: palette.textDim, fontSize: 11, marginTop: 2 },
  btn: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: palette.border },
  primary: { backgroundColor: palette.accent, borderColor: palette.accent },
  btnText: { color: '#fff', fontSize: 12, fontWeight: '800' },
});
