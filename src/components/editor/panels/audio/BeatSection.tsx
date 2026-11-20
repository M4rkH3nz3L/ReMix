import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Text, View } from 'react-native';

import { styles } from '@/components/editor/panels/audio/audioStyles';
import { Chip, PanelSection, PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { logCaught } from '@/lib/logCaught';
import { useEditorStore } from '@/store/editorStore';

export interface BeatSectionProps {
  beatMode: 'beat' | 'downbeat';
  setBeatMode: (mode: 'beat' | 'downbeat') => void;
  beatBusy: boolean;
  suggestedCutCount: number;
  runBeatMarkers: () => Promise<void>;
  runBeatCuts: () => Promise<void>;
}

/** 🥁 beat → marker / vágás */
export function BeatSection({ beatMode, setBeatMode, beatBusy, suggestedCutCount, runBeatMarkers, runBeatCuts }: BeatSectionProps) {
  const { t } = useTranslation();
  return (
    <PanelSection title={t('panels.audio.beatTitle')}>
      <View style={styles.chipRow}>
        <Chip
          label={t('panels.audio.beatDownbeat')}
          active={beatMode === 'downbeat'}
          onPress={() => setBeatMode('downbeat')}
        />
        <Chip
          label={t('panels.audio.beatEveryBeat')}
          active={beatMode === 'beat'}
          onPress={() => setBeatMode('beat')}
        />
      </View>
      {beatBusy ? (
        <View style={styles.ttsBusy}>
          <ActivityIndicator color={palette.accent} />
          <Text style={styles.note}>{t('panels.audio.beatDetecting')}</Text>
        </View>
      ) : (
        <View style={styles.chipRow}>
          <Chip
            label={t('panels.audio.beatToMarkers')}
            active={false}
            onPress={() => {
              runBeatMarkers().catch((caught) => { logCaught('components/editor/panels/AudioPanel.tsx:AudioPanel', caught); });
            }}
          />
          <Chip
            label={t('panels.audio.beatToCuts')}
            active={false}
            onPress={() => {
              runBeatCuts().catch((caught) => { logCaught('components/editor/panels/AudioPanel.tsx:AudioPanel', caught); });
            }}
          />
        </View>
      )}
      {suggestedCutCount > 0 ? (
        <>
          <PrimaryButton
            icon="cut"
            label={t('panels.audio.beatApplyCuts', { count: suggestedCutCount })}
            onPress={() => useEditorStore.getState().applySuggestedCuts()}
          />
          <View style={styles.chipRow}>
            <Chip
              label={t('panels.audio.beatDiscardCuts')}
              active={false}
              onPress={() => useEditorStore.getState().clearSuggestedCuts()}
            />
          </View>
        </>
      ) : null}
      <Text style={styles.note}>{t('panels.audio.beatHint')}</Text>
    </PanelSection>
  );
}
