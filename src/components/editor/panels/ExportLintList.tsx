import { Ionicons } from '@expo/vector-icons';
import i18n from 'i18next';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { exportLint, TEMPLATE_PLACEHOLDER_KEYS, type ExportIssue } from '@/lib/exportLint';
import { findMissingMedia } from '@/lib/videdFile';
import { useEditorStore } from '@/store/editorStore';
import type { Project } from '@/types/project';

/** a helyőrzők MINDEN nyelven (a projekt más nyelvű felületről is jöhetett) */
function placeholderTexts(): string[] {
  const langs = Object.keys(i18n.options.resources ?? {});
  return TEMPLATE_PLACEHOLDER_KEYS.flatMap((k) => langs.map((lng) => i18n.t(k, { lng }))).filter(
    (s): s is string => typeof s === 'string' && !TEMPLATE_PLACEHOLDER_KEYS.includes(s)
  );
}

/**
 * 🧹 Export előtti tartalom-ellenőrzés (D1): ott maradt sablon-szöveg, üres szöveg,
 * hiányzó média, néma kimenet. Figyelmeztet, nem tilt; koppintásra a klipre ugrik.
 */
export function ExportLintList({ project }: { project: Project }) {
  const { t } = useTranslation();
  const issues = useMemo(
    () =>
      exportLint(project, {
        placeholders: placeholderTexts(),
        missingUris: findMissingMedia(project).map((m) => m.uri),
      }),
    [project]
  );
  if (issues.length === 0) {
    return (
      <View style={styles.ok}>
        <Ionicons name="checkmark-circle" size={15} color={palette.ok} />
        <Text style={styles.okText}>{t('panels.export.lint.ok')}</Text>
      </View>
    );
  }
  const jump = (i: ExportIssue) => {
    if (!i.clipId) return;
    const s = useEditorStore.getState();
    s.setPanel(null);
    s.selectClip(i.clipId);
    if (i.start !== undefined) s.setPlayhead(i.start);
  };
  return (
    <View style={styles.box} accessibilityRole="summary">
      <Text style={styles.head}>⚠️ {t('panels.export.lint.title', { count: issues.length })}</Text>
      {issues.map((i, n) => (
        <Pressable
          key={`${i.code}-${i.clipId ?? n}`}
          onPress={() => jump(i)}
          disabled={!i.clipId}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          accessibilityRole={i.clipId ? 'button' : undefined}
          accessibilityHint={i.clipId ? t('panels.export.lint.jump') : undefined}
        >
          <Text style={styles.text}>{t(`panels.export.lint.${i.code}`, { detail: i.detail ?? '' })}</Text>
          {i.clipId ? <Ionicons name="chevron-forward" size={14} color={palette.textDim} /> : null}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderColor: palette.warning,
    borderRadius: 10,
    padding: 10,
    gap: 4,
    backgroundColor: `${palette.warning}14`,
  },
  head: { color: palette.text, fontSize: 13, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 },
  text: { color: palette.text, fontSize: 12, lineHeight: 17, flex: 1 },
  pressed: { opacity: 0.6 },
  ok: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  okText: { color: palette.textDim, fontSize: 12 },
});
