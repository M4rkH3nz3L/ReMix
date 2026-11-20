import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { styles } from '@/components/editor/panels/audio/audioStyles';
import { Chip, PanelSection, Stepper } from '@/components/ui/controls';
import { clipFxOf, formatEqDb, stepEqBand, stepHighpass, stepLowpass, stepWet } from '@/lib/audioPanelOps';
import type { EditorState } from '@/store/editorStore';
import type { AudioClip, AudioFx } from '@/types/project';

/** 🎛️ Pro audio-effektek — a renderben alkalmazódnak (előnézet közelít) */
export function AudioFxSection({ clip, updateClip }: { clip: AudioClip; updateClip: EditorState['updateClip'] }) {
  const { t } = useTranslation();
  // 🎛️ per-klip audio-FX olvasó/író segédek (a kijelölt klipre)
  const { fx, eq } = clipFxOf(clip);
  const setFx = (patch: Partial<AudioFx>) => {
    if (clip) {
      updateClip(clip.id, { audioFx: { ...fx, ...patch } });
    }
  };
  const setEq = (patch: Partial<typeof eq>) => setFx({ eq: { ...eq, ...patch } });
  return (
    <PanelSection title={t('panels.audio.fxTitle')}>
      <Stepper
        label={t('panels.audio.fxHighpass')}
        value={fx.highpass ? `${fx.highpass} Hz` : t('common.off')}
        onDec={() => setFx({ highpass: stepHighpass(fx.highpass, -1) })}
        onInc={() => setFx({ highpass: stepHighpass(fx.highpass, 1) })}
      />
      <Stepper
        label={t('panels.audio.fxLowpass')}
        value={fx.lowpass ? `${Math.round(fx.lowpass / 1000)} kHz` : t('common.off')}
        onDec={() => setFx({ lowpass: stepLowpass(fx.lowpass, -1) })}
        onInc={() => setFx({ lowpass: stepLowpass(fx.lowpass, 1) })}
      />
      <Stepper
        label={t('panels.audio.fxEqLow')}
        value={formatEqDb(eq.low)}
        onDec={() => setEq({ low: stepEqBand(eq.low, -1) })}
        onInc={() => setEq({ low: stepEqBand(eq.low, 1) })}
      />
      <Stepper
        label={t('panels.audio.fxEqMid')}
        value={formatEqDb(eq.mid)}
        onDec={() => setEq({ mid: stepEqBand(eq.mid, -1) })}
        onInc={() => setEq({ mid: stepEqBand(eq.mid, 1) })}
      />
      <Stepper
        label={t('panels.audio.fxEqHigh')}
        value={formatEqDb(eq.high)}
        onDec={() => setEq({ high: stepEqBand(eq.high, -1) })}
        onInc={() => setEq({ high: stepEqBand(eq.high, 1) })}
      />
      <Stepper
        label={t('panels.audio.fxReverb')}
        value={`${Math.round((fx.reverb ?? 0) * 100)}%`}
        onDec={() => setFx({ reverb: stepWet(fx.reverb, -1) })}
        onInc={() => setFx({ reverb: stepWet(fx.reverb, 1) })}
      />
      <Stepper
        label={t('panels.audio.fxDelay')}
        value={`${Math.round((fx.delay ?? 0) * 100)}%`}
        onDec={() => setFx({ delay: stepWet(fx.delay, -1) })}
        onInc={() => setFx({ delay: stepWet(fx.delay, 1) })}
      />
      <View style={styles.chipRow}>
        <Chip label={t('panels.audio.fxDenoise')} active={fx.denoise === true} onPress={() => setFx({ denoise: !fx.denoise })} />
        <Chip label={t('panels.audio.fxDeEsser')} active={fx.deEsser === true} onPress={() => setFx({ deEsser: !fx.deEsser })} />
        <Chip label={t('panels.audio.fxCompressor')} active={fx.compressor === true} onPress={() => setFx({ compressor: !fx.compressor })} />
        <Chip label={t('panels.audio.fxLimiter')} active={fx.limiter === true} onPress={() => setFx({ limiter: !fx.limiter })} />
        <Chip label={t('panels.audio.fxNormalize')} active={fx.normalize === true} onPress={() => setFx({ normalize: !fx.normalize })} />
      </View>
      <Text style={styles.note}>{t('panels.audio.fxHint')}</Text>
    </PanelSection>
  );
}
