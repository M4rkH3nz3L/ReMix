import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text } from 'react-native';

import { AiProviderPicker } from '@/components/editor/AiProviderPicker';
import { PanelSection, PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { buildHookClip, replaceHookClips } from '@/lib/hooks';
import type { HookSuggestion } from '@/lib/hooks';
import { fetchHooks } from '@/lib/hooksClient';
import { makeId } from '@/lib/id';
import { projectDuration } from '@/lib/projectUtils';
import { getTimelineTranscript } from '@/lib/transcripts';
import { useEditorStore } from '@/store/editorStore';

/**
 * 🪝 Hook Generator: erősebb nyitómondatok a videó témájából. Önálló AI-mód —
 * saját state + handler; a közös busy-sávot (`busy`/`setBusy`) és az
 * „alkalmazva" visszajelzést (`setApplied`) a panel adja propként.
 */
export function HooksSection({
  busy,
  setBusy,
  setApplied,
}: {
  busy: string | null;
  setBusy: (status: string | null) => void;
  setApplied: (message: string | null) => void;
}) {
  const { t } = useTranslation();
  const [hooks, setHooks] = useState<HookSuggestion[] | null>(null);

  const generateHooks = async () => {
    const state = useEditorStore.getState();
    if (!state.project || busy) {
      return;
    }
    setBusy(t('panels.assistant.hookWriting'));
    try {
      const transcript = await getTimelineTranscript(state.project).catch(() => null);
      const lines = (transcript ?? []).slice(0, 12).map((l) => l.text);
      const summary = `${state.project.name}\n${lines.join('\n')}`.slice(0, 900);
      const list = await fetchHooks(summary);
      if (!list) {
        Alert.alert(
          t('panels.assistant.hookGeneratorTitle'),
          t('panels.assistant.hookUnavailable')
        );
        return;
      }
      setHooks(list);
    } finally {
      setBusy(null);
    }
  };

  /** a választott hook cím-klipként a szöveg-sáv elejére (a korábbit cserélve) */
  const applyHook = (hook: HookSuggestion) => {
    const state = useEditorStore.getState();
    if (!state.project) {
      return;
    }
    const clip = buildHookClip(
      hook.text,
      projectDuration(state.project),
      () => makeId('clip')
    );
    const textTrack = state.project.tracks.find((t) => t.type === 'text');
    const clips = replaceHookClips(textTrack?.clips ?? [], clip);
    const ok = state.dispatch(
      { type: 'REPLACE_TRACK_CLIPS', trackType: 'text', clips },
      'ai'
    );
    setApplied(
      ok ? t('panels.assistant.hookApplied', { text: hook.text }) : t('panels.assistant.applyFailed')
    );
  };

  return (
    <PanelSection title={t('panels.assistant.sectionHookGenerator')}>
      <AiProviderPicker task="hooks" />
      <PrimaryButton
        icon="flash-outline"
        label={busy ?? t('panels.assistant.hookGenerateBtn')}
        onPress={() => {
          generateHooks().catch((err: Error) =>
            Alert.alert('Hook Generator', err.message)
          );
        }}
      />
      {hooks?.map((hook) => (
        <Pressable
          key={hook.text}
          style={styles.variantCard}
          onPress={() => applyHook(hook)}
        >
          <Text style={styles.variantTitle}>{hook.text}</Text>
          <Text style={styles.variantMeta}>
            {t('panels.assistant.hookMeta', { style: hook.style, count: hook.text.length })}
          </Text>
        </Pressable>
      ))}
      <Text style={styles.note}>{t('panels.assistant.hookNote')}</Text>
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
  variantTitle: {
    color: palette.text,
    fontSize: 13,
    fontWeight: '700',
  },
  variantMeta: {
    color: palette.accent,
    fontSize: 11,
  },
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 8,
  },
});
