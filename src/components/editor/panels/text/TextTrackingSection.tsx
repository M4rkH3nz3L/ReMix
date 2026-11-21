import { useTranslation } from 'react-i18next';
import { Alert, Text } from 'react-native';

import { styles } from '@/components/editor/panels/text/textStyles';
import { Chip, PanelSection, PrimaryButton } from '@/components/ui/controls';
import { logCaught } from '@/lib/logCaught';
import { useEditorStore } from '@/store/editorStore';
import type { TextClip } from '@/types/project';

export interface TextTrackingSectionProps {
  clip: TextClip;
  trackStatus: string | null;
  pickHint: string | null;
  setPickHint: (hint: string | null) => void;
  startTracking: (point?: { x: number; y: number }) => Promise<void>;
  trackFace: () => Promise<void>;
}

/** 🎯 követés: playheadtől, kijelölt pontból, arcról; követés törlése */
export function TextTrackingSection({ clip, trackStatus, pickHint, setPickHint, startTracking, trackFace }: TextTrackingSectionProps) {
  const { t: tr } = useTranslation();
  return (
    <PanelSection title={tr('panels.text.sectionTracking')}>
      <PrimaryButton
        icon="locate-outline"
        label={trackStatus ?? tr('panels.text.trackFromPlayhead')}
        onPress={() => {
          startTracking().catch((err: Error) =>
            { logCaught('components/editor/panels/TextPanel.tsx:TextPanel', err); return Alert.alert(tr('panels.text.trackTitle'), err.message); }
          );
        }}
      />
      <PrimaryButton
        icon="locate"
        label={pickHint ?? tr('panels.text.pickPoint')}
        onPress={() => {
          setPickHint(tr('panels.text.pickPointHint'));
          useEditorStore.getState().setPanel(null);
          useEditorStore.getState().setPickTarget((point) => {
            setPickHint(null);
            useEditorStore.getState().setPanel('text');
            startTracking(point).catch((err: Error) =>
              { logCaught('components/editor/panels/TextPanel.tsx:TextPanel', err); return Alert.alert(tr('panels.text.trackTitle'), err.message); }
            );
          });
        }}
      />
      <PrimaryButton
        icon="happy-outline"
        label={trackStatus ?? tr('panels.text.trackFace')}
        onPress={() => {
          trackFace().catch((err: Error) =>
            { logCaught('components/editor/panels/TextPanel.tsx:TextPanel', err); return Alert.alert(tr('panels.text.faceTrackTitle'), err.message); }
          );
        }}
      />
      {clip.keyframes ? (
        <Chip
          label={tr('panels.text.clearTracking')}
          active={false}
          onPress={() =>
            useEditorStore.getState().updateClip(clip.id, { keyframes: undefined })
          }
        />
      ) : null}
      <Text style={styles.note}>{tr('panels.text.noteTracking')}</Text>
    </PanelSection>
  );
}
