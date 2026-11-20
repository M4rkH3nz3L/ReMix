import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { clipEditStyles } from '@/components/studio/audio/clipEdit/clipEditStyles';
import { palette } from '@/constants/editor';
import { STEM_SEPARATION_ENABLED } from '@/lib/stems';
import { stemOnDeviceVisible } from '@/lib/stemSeparationClient';

/** 🔇✂️🔗 a lapot bezáró eszközök: csend-keresés, szöveges vágás, szinkron, stem-szeparáció (telefonon / Pro) */
export function ClipToolsSection({
  clipId,
  separating,
  onSeparate,
  findSilence,
  openSpeechEdit,
  openAudioSync,
  onStemsOnDevice,
}: {
  clipId: string;
  separating: boolean;
  onSeparate: () => void;
  findSilence: () => void;
  openSpeechEdit: () => void;
  openAudioSync: () => void;
  onStemsOnDevice?: (clipId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {/* 🔇 csendek keresése → jóváhagyás az idővonalon */}
      <View style={clipEditStyles.divider} />
      <Pressable testID="clip-find-silence" onPress={() => findSilence()} style={styles.stemsBtn}>
        <Ionicons name="cut-outline" size={16} color={palette.accent} />
        <Text style={styles.stemsText}>{t('studio.audio.silence.find')}</Text>
      </Pressable>
      <Text style={clipEditStyles.hint}>{t('studio.audio.silence.findHint')}</Text>

      {/* ✂️💬 szöveges vágás: a sáv átirata az idővonal alatt */}
      <Pressable testID="clip-speech-edit" onPress={() => openSpeechEdit()} style={[styles.stemsBtn, { marginTop: 12 }]}>
        <Ionicons name="chatbubble-ellipses-outline" size={16} color={palette.accent} />
        <Text style={styles.stemsText}>{t('studio.audio.speech.open')}</Text>
      </Pressable>
      <Text style={clipEditStyles.hint}>{t('studio.audio.speech.openHint')}</Text>

      {/* 🔗 külső hang szinkronja a hangja alapján */}
      <Pressable testID="clip-audio-sync" onPress={() => openAudioSync()} style={[styles.stemsBtn, { marginTop: 12 }]}>
        <Ionicons name="git-compare-outline" size={16} color={palette.accent} />
        <Text style={styles.stemsText}>{t('studio.audio.sync.open')}</Text>
      </Pressable>
      <Text style={clipEditStyles.hint}>{t('studio.audio.sync.openHint', { sec: 30 })}</Text>

      {/* 🎚️ V5: ének + kíséret a telefonon (ingyenes) — a licenc-megerősítésig csak dev-buildben */}
      {onStemsOnDevice && stemOnDeviceVisible() ? (
        <>
          <View style={clipEditStyles.divider} />
          <Pressable onPress={() => onStemsOnDevice(clipId)} style={styles.stemsBtn} accessibilityRole="button" testID="stems-ondevice">
            <Ionicons name="git-branch-outline" size={16} color={palette.accent} />
            <Text style={styles.stemsText}>{t('studio.audio.stemsOnDevice')}</Text>
          </Pressable>
          <Text style={clipEditStyles.hint}>{t('studio.audio.stemsOnDeviceHint')}</Text>
        </>
      ) : null}
      {/* 🎚️ AI stem-szeparáció (Pro) — kiadásból elrejtve, lásd STEM_SEPARATION_ENABLED */}
      {STEM_SEPARATION_ENABLED ? (
        <>
          <View style={clipEditStyles.divider} />
          <Pressable onPress={onSeparate} disabled={separating} style={styles.stemsBtn}>
            <Ionicons
              name={separating ? 'hourglass-outline' : 'git-branch-outline'}
              size={16}
              color={palette.accent}
            />
            <Text style={styles.stemsText}>{t('studio.audio.stems')}</Text>
            <View style={styles.proTag}>
              <Text style={styles.proTagText}>PRO</Text>
            </View>
          </Pressable>
          <Text style={clipEditStyles.hint}>{t('studio.audio.stemsHint')}</Text>
        </>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  proTag: { backgroundColor: palette.accentSoft, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  proTagText: { color: palette.accent, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  stemsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceHigh,
  },
  stemsText: { flex: 1, color: palette.text, fontSize: 14, fontWeight: '700' },
});
