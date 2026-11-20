import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { clipEditStyles as styles } from '@/components/studio/audio/clipEdit/clipEditStyles';
import { Chip } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import type { AudioClip } from '@/types/project';

/** 🔇 V8: AI-zajszűrés (neurális, a telefonon, ingyenes) — az eredetiből új fájl, visszaállítható */
export function AiDenoiseSection({
  clip,
  aiStrength,
  setAiStrength,
  onAiDenoise,
  onResetAiDenoise,
}: {
  clip: AudioClip;
  aiStrength: number;
  setAiStrength: (v: number) => void;
  onAiDenoise: (clipId: string, strength: number) => void;
  onResetAiDenoise?: (clipId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.tuneBox}>
      <Text style={styles.autoLabel}>{t('studio.audio.aiDenoise.title')}</Text>
      <Text style={styles.hint}>{t('studio.audio.aiDenoise.hint')}</Text>
      <View style={styles.autoChips}>
        {[0.5, 0.75, 1].map((v) => (
          <Chip key={v} label={`${Math.round(v * 100)}%`} active={aiStrength === v} onPress={() => setAiStrength(v)} />
        ))}
      </View>
      <View style={styles.tuneRow}>
        <Pressable onPress={() => onAiDenoise(clip.id, aiStrength)} style={styles.tuneBtn} accessibilityRole="button" testID="ai-denoise-apply">
          <Ionicons name="sparkles-outline" size={16} color="#fff" />
          <Text style={styles.tuneBtnText}>{t('studio.audio.aiDenoise.apply')}</Text>
        </Pressable>
        {clip.aiDenoise && onResetAiDenoise ? (
          <Pressable onPress={() => onResetAiDenoise(clip.id)} style={styles.tuneReset} accessibilityRole="button" testID="ai-denoise-reset">
            <Ionicons name="refresh-outline" size={15} color={palette.textDim} />
            <Text style={styles.tuneResetText}>{t('studio.audio.aiDenoise.reset')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
