import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { styles } from '@/components/editor/panels/precision/precisionStyles';
import { Chip, PanelSection, Stepper } from '@/components/ui/controls';
import { FPS_OPTIONS, formatTimecode, secToFrame } from '@/lib/frames';
import type { StepMode } from '@/lib/precisionPanelOps';
import type { EditorState } from '@/store/editorStore';
import type { Clip } from '@/types/project';

/** a projekt frame-rátájának (timebase) választója */
export function TimebaseSection({ fps, dispatch }: { fps: number; dispatch: EditorState['dispatch'] }) {
  const { t } = useTranslation();
  return (
    <PanelSection title={t('panels.precision.timebaseTitle')}>
      <View style={styles.row}>
        {FPS_OPTIONS.map((f) => (
          <Chip
            key={f}
            label={`${f}`}
            active={fps === f}
            onPress={() => dispatch({ type: 'SET_FPS', fps: f })}
          />
        ))}
      </View>
      <Text style={styles.range}>{t('panels.precision.timebaseNote', { fps })}</Text>
    </PanelSection>
  );
}

/** a lépés-mód (mp / kocka) + a klip kezdetének és hosszának léptetése timecode-dal */
export function TimingSection({
  clip,
  fps,
  stepMode,
  setStepMode,
  step,
  setStart,
  setDuration,
}: {
  clip: Clip;
  fps: number;
  stepMode: StepMode;
  setStepMode: (mode: StepMode) => void;
  step: number;
  setStart: (start: number) => void;
  setDuration: (duration: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <PanelSection title={t('panels.precision.timingTitle')}>
      <View style={styles.row}>
        <Chip
          label={t('panels.precision.stepSec')}
          active={stepMode === 'sec'}
          onPress={() => setStepMode('sec')}
        />
        <Chip
          label={t('panels.precision.stepFrame', { fps })}
          active={stepMode === 'frame'}
          onPress={() => setStepMode('frame')}
        />
      </View>
      <Stepper
        label={t('panels.precision.start')}
        value={formatTimecode(clip.start, fps)}
        onDec={() => setStart(clip.start - step)}
        onInc={() => setStart(clip.start + step)}
      />
      <Stepper
        label={t('panels.precision.length')}
        value={formatTimecode(clip.duration, fps)}
        onDec={() => setDuration(clip.duration - step)}
        onInc={() => setDuration(clip.duration + step)}
      />
      <Text style={styles.range}>
        {formatTimecode(clip.start, fps)} → {formatTimecode(clip.start + clip.duration, fps)}
        {stepMode === 'frame'
          ? t('panels.precision.frameInfo', {
              startFrame: secToFrame(clip.start, fps),
              frameCount: secToFrame(clip.duration, fps),
            })
          : ''}
      </Text>
    </PanelSection>
  );
}

/** lejátszófej-léptetés és a klip ↔ lejátszófej igazítása */
export function AlignSection({
  clip,
  stepMode,
  nudgePlayhead,
  alignToPlayhead,
  setPlayhead,
}: {
  clip: Clip;
  stepMode: StepMode;
  nudgePlayhead: (dir: 1 | -1) => void;
  alignToPlayhead: () => void;
  setPlayhead: EditorState['setPlayhead'];
}) {
  const { t } = useTranslation();
  return (
    <PanelSection title={t('panels.precision.alignTitle')}>
      <View style={styles.row}>
        <Chip
          label={
            stepMode === 'frame'
              ? t('panels.precision.nudgeBackFrame')
              : t('panels.precision.nudgeBackSec')
          }
          active={false}
          onPress={() => nudgePlayhead(-1)}
        />
        <Chip
          label={
            stepMode === 'frame'
              ? t('panels.precision.nudgeFwdFrame')
              : t('panels.precision.nudgeFwdSec')
          }
          active={false}
          onPress={() => nudgePlayhead(1)}
        />
        <Chip label={t('panels.precision.startToPlayhead')} active={false} onPress={alignToPlayhead} />
        <Chip
          label={t('panels.precision.playheadToClipStart')}
          active={false}
          onPress={() => setPlayhead(clip.start)}
        />
        <Chip
          label={t('panels.precision.playheadToClipEnd')}
          active={false}
          onPress={() => setPlayhead(clip.start + clip.duration)}
        />
      </View>
    </PanelSection>
  );
}
