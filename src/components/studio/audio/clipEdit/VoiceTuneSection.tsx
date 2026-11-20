import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { Slider } from '@/components/studio/audio/primitives';
import { clipEditStyles as styles } from '@/components/studio/audio/clipEdit/clipEditStyles';
import { Chip } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { NOTE_ROOTS } from '@/lib/chords';
import type { AudioClip } from '@/types/project';

/** 🎤 V3.2: ének-hangolás hangonként (a skálára) + dallamkövető harmónia — a telefon új fájlt készít */
export function VoiceTuneSection({
  clip,
  tuneRoot,
  setTuneRoot,
  tuneMinor,
  setTuneMinor,
  tuneStrength,
  setTuneStrength,
  tuneHarmony,
  setTuneHarmony,
  onTune,
  onHumMelody,
  onResetTune,
}: {
  clip: AudioClip;
  tuneRoot: number;
  setTuneRoot: (v: number) => void;
  tuneMinor: boolean;
  setTuneMinor: (v: boolean) => void;
  tuneStrength: number;
  setTuneStrength: (v: number) => void;
  tuneHarmony: number;
  setTuneHarmony: (v: number) => void;
  onTune: (clipId: string, s: { root: number; minor: boolean; strength: number; harmonySteps?: number }) => void;
  onHumMelody?: (clipId: string, key: { root: number; minor: boolean }) => void;
  onResetTune?: (clipId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.tuneBox}>
      <Text style={styles.autoLabel}>{t('studio.audio.tune.title')}</Text>
      <Text style={styles.hint}>{t('studio.audio.tune.hint')}</Text>
      <View style={styles.autoChips}>
        {NOTE_ROOTS.map((n, i) => (
          <Chip key={n} label={n} active={tuneRoot === i} onPress={() => setTuneRoot(i)} />
        ))}
      </View>
      <View style={styles.autoChips}>
        <Chip label={t('studio.audio.chords.major')} active={!tuneMinor} onPress={() => setTuneMinor(false)} />
        <Chip label={t('studio.audio.chords.minor')} active={tuneMinor} onPress={() => setTuneMinor(true)} />
      </View>
      <Slider label={t('studio.audio.tune.strength')} value={tuneStrength} min={0} max={1} onChange={(v) => setTuneStrength(Math.round(v * 20) / 20)} format={(v) => `${Math.round(v * 100)}%`} />
      <View style={styles.autoChips}>
        {[0, 2, -2, 4].map((st) => (
          <Chip key={st} label={t(`studio.audio.tune.harmony.${st === 0 ? 'none' : st === 2 ? 'thirdUp' : st === -2 ? 'thirdDown' : 'fifthUp'}`)} active={tuneHarmony === st} onPress={() => setTuneHarmony(st)} />
        ))}
      </View>
      <View style={styles.tuneRow}>
        <Pressable
          onPress={() => onTune(clip.id, { root: tuneRoot, minor: tuneMinor, strength: tuneStrength, ...(tuneHarmony ? { harmonySteps: tuneHarmony } : {}) })}
          style={styles.tuneBtn}
          accessibilityRole="button"
          testID="tune-apply"
        >
          <Ionicons name="mic-outline" size={16} color="#fff" />
          <Text style={styles.tuneBtnText}>{t('studio.audio.tune.apply')}</Text>
        </Pressable>
        {onHumMelody ? (
          <Pressable onPress={() => onHumMelody(clip.id, { root: tuneRoot, minor: tuneMinor })} style={styles.tuneReset} accessibilityRole="button" testID="hum-melody">
            <Ionicons name="musical-notes-outline" size={15} color={palette.textDim} />
            <Text style={styles.tuneResetText}>{t('studio.audio.tune.humMelody')}</Text>
          </Pressable>
        ) : null}
        {clip.tune && onResetTune ? (
          <Pressable onPress={() => onResetTune(clip.id)} style={styles.tuneReset} accessibilityRole="button" testID="tune-reset">
            <Ionicons name="refresh-outline" size={15} color={palette.textDim} />
            <Text style={styles.tuneResetText}>{t('studio.audio.tune.reset')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
