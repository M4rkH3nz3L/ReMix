import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Text } from 'react-native';

import { PanelSection, PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { logCaught } from '@/lib/logCaught';

/**
 * ✂️ Vágó-eszközök szekció: a gombok címkéje a futó művelet státusza; a műveleteket
 * (`useCutTools` / `useReframeTools` / `useFootageInsights`) a panel adja propként.
 */
export function CutToolsSection({
  cutStatus,
  cutDeadAir,
  sceneStatus,
  splitAtScenes,
  beatStatus,
  splitOnBeats,
  fxStatus,
  applyBeatFx,
  reframeStatus,
  smartReframe,
  footageStatus,
  footageCheck,
  brollStatus,
  findBroll,
}: {
  cutStatus: string | null;
  cutDeadAir: () => Promise<void>;
  sceneStatus: string | null;
  splitAtScenes: () => Promise<void>;
  beatStatus: string | null;
  splitOnBeats: () => Promise<void>;
  fxStatus: string | null;
  applyBeatFx: (kind: 'pulse' | 'flash') => Promise<void>;
  reframeStatus: string | null;
  smartReframe: () => Promise<void>;
  footageStatus: string | null;
  footageCheck: () => Promise<void>;
  brollStatus: string | null;
  findBroll: () => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <PanelSection title={t('panels.assistant.sectionCutTools')}>
      <PrimaryButton
        icon="cut-outline"
        label={cutStatus ?? t('panels.assistant.cutDeadAirBtn')}
        onPress={() => {
          cutDeadAir().catch((err: Error) => { logCaught('components/editor/panels/AssistantPanel.tsx:AssistantPanel', err); return Alert.alert(t('panels.assistant.deadAirTitle'), err.message); });
        }}
      />
      <PrimaryButton
        icon="film-outline"
        label={sceneStatus ?? t('panels.assistant.splitScenesBtn')}
        onPress={() => {
          splitAtScenes().catch((err: Error) => { logCaught('components/editor/panels/AssistantPanel.tsx:AssistantPanel', err); return Alert.alert(t('panels.assistant.sceneCutTitle'), err.message); });
        }}
      />
      <PrimaryButton
        icon="musical-notes-outline"
        label={beatStatus ?? t('panels.assistant.splitBeatsBtn')}
        onPress={() => {
          splitOnBeats().catch((err: Error) => { logCaught('components/editor/panels/AssistantPanel.tsx:AssistantPanel', err); return Alert.alert(t('panels.assistant.beatCutTitle'), err.message); });
        }}
      />
      <PrimaryButton
        icon="pulse-outline"
        label={fxStatus ?? t('panels.assistant.beatPulseBtn')}
        onPress={() => {
          applyBeatFx('pulse').catch((err: Error) => { logCaught('components/editor/panels/AssistantPanel.tsx:AssistantPanel', err); return Alert.alert(t('panels.assistant.beatFxTitle'), err.message); });
        }}
      />
      <PrimaryButton
        icon="flash-outline"
        label={fxStatus ?? t('panels.assistant.beatFlashBtn')}
        onPress={() => {
          applyBeatFx('flash').catch((err: Error) => { logCaught('components/editor/panels/AssistantPanel.tsx:AssistantPanel', err); return Alert.alert(t('panels.assistant.beatFxTitle'), err.message); });
        }}
      />
      <PrimaryButton
        icon="crop-outline"
        label={reframeStatus ?? t('panels.assistant.smartReframeBtn')}
        onPress={() => {
          smartReframe().catch((err: Error) => { logCaught('components/editor/panels/AssistantPanel.tsx:AssistantPanel', err); return Alert.alert(t('panels.assistant.reframeTitle'), err.message); });
        }}
      />
      <PrimaryButton
        icon="search-outline"
        label={footageStatus ?? t('panels.assistant.footageCheckBtn')}
        onPress={() => {
          footageCheck().catch((err: Error) => { logCaught('components/editor/panels/AssistantPanel.tsx:AssistantPanel', err); return Alert.alert(t('panels.assistant.footageTitle'), err.message); });
        }}
      />
      <PrimaryButton
        icon="images-outline"
        label={brollStatus ?? t('panels.assistant.brollBtn')}
        onPress={() => {
          findBroll().catch((err: Error) => { logCaught('components/editor/panels/AssistantPanel.tsx:AssistantPanel', err); return Alert.alert(t('panels.assistant.brollTitle'), err.message); });
        }}
      />
      <Text style={styles.note}>{t('panels.assistant.cutToolsNote')}</Text>
    </PanelSection>
  );
}

const styles = StyleSheet.create({
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 8,
  },
});
