import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, View } from 'react-native';

import { Chip, PanelSection } from '@/components/ui/controls';
import { logCaught } from '@/lib/logCaught';

/**
 * ⚡ AI Command Bar: a leggyakoribb power-parancsok egy sorban — a műveleteket
 * a panel adja propként (a hookjaiból).
 */
export function CommandBarSection({
  cutDeadAir,
  splitOnBeats,
  smartReframe,
  setTargetSeconds,
  startAutoEdit,
  send,
}: {
  cutDeadAir: () => Promise<void>;
  splitOnBeats: () => Promise<void>;
  smartReframe: () => Promise<void>;
  setTargetSeconds: (seconds: number) => void;
  startAutoEdit: () => Promise<void>;
  send: (text: string) => Promise<void>;
}) {
  const { t } = useTranslation();

  // AI Command Bar (P0‑1): a leggyakoribb power-parancsok egy sorban —
  // determinisztikus eszközök és AI-promptok vegyesen, egy koppintásra
  const commandBar: { label: string; run: () => void }[] = [
    {
      label: t('panels.assistant.cmdSilenceOut'),
      run: () => {
        cutDeadAir().catch((err: Error) => { logCaught('components/editor/panels/AssistantPanel.tsx:AssistantPanel', err); return Alert.alert(t('panels.assistant.deadAirTitle'), err.message); });
      },
    },
    {
      label: t('panels.assistant.cmdBeatCut'),
      run: () => {
        splitOnBeats().catch((err: Error) => { logCaught('components/editor/panels/AssistantPanel.tsx:AssistantPanel', err); return Alert.alert(t('panels.assistant.beatCutTitle'), err.message); });
      },
    },
    {
      label: t('panels.assistant.cmdReframe'),
      run: () => {
        smartReframe().catch((err: Error) => { logCaught('components/editor/panels/AssistantPanel.tsx:AssistantPanel', err); return Alert.alert(t('panels.assistant.reframeTitle'), err.message); });
      },
    },
    {
      label: t('panels.assistant.cmdShort30'),
      run: () => {
        setTargetSeconds(30);
        startAutoEdit().catch((err: Error) => { logCaught('components/editor/panels/AssistantPanel.tsx:AssistantPanel', err); return Alert.alert(t('panels.assistant.autoEditTitle'), err.message); });
      },
    },
    { label: t('panels.assistant.cmdCaption'), run: () => send(t('panels.assistant.promptCaption')) },
    { label: t('panels.assistant.cmdTitleHook'), run: () => send(t('panels.assistant.promptTitleHook')) },
  ];

  return (
    <PanelSection title={t('panels.assistant.sectionCommands')}>
      <View style={styles.row}>
        {commandBar.map((cmd) => (
          <Chip key={cmd.label} label={cmd.label} active={false} onPress={cmd.run} />
        ))}
      </View>
    </PanelSection>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
});
