import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { AiProviderPicker } from '@/components/editor/AiProviderPicker';
import { Chip, PanelSection, PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { variantKeepSeconds } from '@/lib/assistantPanelOps';
import type { AutoEditVariant } from '@/lib/autoedit';
import type { Highlight } from '@/lib/highlightsClient';
import { logCaught } from '@/lib/logCaught';
import { formatTime } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';

/**
 * 🎬 Auto Edit szekció: cél-hossz, változat-kártyák (▶ előnézet / alkalmazás) és
 * a long-form → shorts highlight-jelöltek. Állapot és műveletek a `useAutoEdit`-ből.
 */
export function AutoEditSection({
  targetSeconds,
  setTargetSeconds,
  autoStatus,
  autoResult,
  startAutoEdit,
  previewingId,
  previewVariant,
  applyVariant,
  highlightStatus,
  highlights,
  findShorts,
}: {
  targetSeconds: number;
  setTargetSeconds: (seconds: number) => void;
  autoStatus: string | null;
  autoResult: { variants: AutoEditVariant[]; source: 'ai' | 'heuristic' } | null;
  startAutoEdit: () => Promise<void>;
  previewingId: string | null;
  previewVariant: (variant: AutoEditVariant) => void;
  applyVariant: (variant: AutoEditVariant) => void;
  highlightStatus: string | null;
  highlights: Highlight[] | null;
  findShorts: () => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <PanelSection title={t('panels.assistant.sectionAutoEdit')}>
      <AiProviderPicker task="autoEdit" />
      <View style={styles.row}>
        {[15, 30, 60].map((sec) => (
          <Chip
            key={sec}
            label={t('panels.assistant.seconds', { count: sec })}
            active={targetSeconds === sec}
            onPress={() => setTargetSeconds(sec)}
          />
        ))}
      </View>
      <PrimaryButton
        icon="flash-outline"
        label={autoStatus ?? t('panels.assistant.autoEditStart', { seconds: targetSeconds })}
        onPress={() => {
          startAutoEdit().catch((err: Error) => { logCaught('components/editor/panels/AssistantPanel.tsx:AssistantPanel', err); return Alert.alert('Auto Edit', err.message); });
        }}
      />
      {autoResult ? (
        <>
          {autoResult.variants.map((variant) => (
            <Pressable
              key={variant.id}
              style={[
                styles.variantCard,
                previewingId === variant.id ? styles.variantCardActive : null,
              ]}
              onPress={() => applyVariant(variant)}
            >
              <Text style={styles.variantTitle}>{variant.title}</Text>
              <Text style={styles.variantMeta}>
                {t('panels.assistant.variantMeta', {
                  seconds: variantKeepSeconds(variant).toFixed(1),
                  segments: variant.keep.length,
                  captions: variant.captions.length,
                })}
              </Text>
              <Text style={styles.variantRationale} numberOfLines={2}>
                {variant.rationale}
              </Text>
              <View style={styles.variantActions}>
                <Chip
                  label={
                    previewingId === variant.id
                      ? t('panels.assistant.previewStop')
                      : t('panels.assistant.previewPlay')
                  }
                  active={previewingId === variant.id}
                  onPress={() => previewVariant(variant)}
                />
              </View>
            </Pressable>
          ))}
          <Text style={styles.note}>
            {autoResult.source === 'ai'
              ? t('panels.assistant.variantsAiNote')
              : t('panels.assistant.variantsHeuristicNote')}
          </Text>
        </>
      ) : (
        <Text style={styles.note}>{t('panels.assistant.autoEditIntro')}</Text>
      )}

      {/* 🎯 long-form → shorts: önálló highlight-jelöltek (Phase 3.3) */}
      <PrimaryButton
        icon="albums-outline"
        label={highlightStatus ?? t('panels.assistant.findShortsBtn')}
        onPress={() => {
          findShorts().catch((err: Error) => { logCaught('components/editor/panels/AssistantPanel.tsx:AssistantPanel', err); return Alert.alert(t('panels.assistant.shortsTitle'), err.message); });
        }}
      />
      {highlights?.map((h, i) => (
        <Pressable
          key={`hl-${i}-${h.start.toFixed(1)}`}
          style={styles.variantCard}
          onPress={() => useEditorStore.getState().setPlayhead(h.start)}
        >
          <Text style={styles.variantTitle}>{h.title || t('panels.assistant.shortsTitle')}</Text>
          <Text style={styles.variantMeta}>
            ▶ {formatTime(h.start)}–{formatTime(h.end)} · {(h.end - h.start).toFixed(0)}s
          </Text>
          <Text style={styles.variantRationale} numberOfLines={2}>
            {h.reason}
          </Text>
        </Pressable>
      ))}
    </PanelSection>
  );
}

const styles = StyleSheet.create({
  variantCard: {
    backgroundColor: palette.surfaceHigh,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
  },
  variantCardActive: {
    borderColor: palette.accent,
  },
  variantActions: {
    flexDirection: 'row',
    marginTop: 6,
  },
  variantTitle: {
    color: palette.text,
    fontSize: 13,
    fontWeight: '700',
  },
  variantMeta: {
    color: palette.accent,
    fontSize: 11,
  },
  variantRationale: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 15,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 8,
  },
});
