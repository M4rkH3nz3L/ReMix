import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AudioLayer } from '@/components/preview/AudioLayer';
import { PreviewSurface } from '@/components/preview/PreviewSurface';
import { palette } from '@/constants/editor';
import { usePlaybackClock } from '@/hooks/usePlaybackClock';
import { projectDuration } from '@/lib/projectUtils';
import { loadProject } from '@/lib/storage';
import { isValidActionUrl } from '@/lib/url';
import { useEditorStore } from '@/store/editorStore';
import { formatTime } from '@/lib/time';
import type { InteractiveClip } from '@/types/project';

/**
 * Interaktív lejátszó: a hotspotok élőben kattinthatók — URL-megnyitás,
 * ugrás egy időpontra (elágazó történet alapja) vagy kvíz.
 */
export default function PlayerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const project = useEditorStore((s) => s.project);
  const playhead = useEditorStore((s) => s.playhead);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const masterVolume = useEditorStore((s) => s.masterVolume);
  const setMasterVolume = useEditorStore((s) => s.setMasterVolume);
  const { t } = useTranslation();

  const [quiz, setQuiz] = useState<InteractiveClip | null>(null);
  const [answered, setAnswered] = useState<number | null>(null);

  usePlaybackClock();

  useEffect(() => {
    if (!id) {
      return;
    }
    const current = useEditorStore.getState().project;
    if (current?.id === id) {
      return;
    }
    // ⚠️ `alive` guard: a betöltés a GLOBÁLIS store-t írja — gyors váltásnál a
    // késői válasz enélkül felülírná a frisset (lásd editor/[id].tsx)
    let alive = true;
    loadProject(id)
      .then((loaded) => {
        if (alive && loaded) {
          useEditorStore.getState().loadProject(loaded);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    // belépéskor elölről indítunk
    setPlayhead(0);
    // 🌐 WEB: a böngésző TILTJA a hangos lejátszást felhasználói gesztus nélkül
    // (közvetlen URL-megnyitásnál nincs gesztus). Ha itt auto-indítanánk, a
    // rAF-mesteróra léptetné a lejátszófejet és a videó NÉMÁN „pörögne" — pont a
    // „nincs hang" tünet. Ezért weben nem auto-indítunk: az első Play-koppintás
    // (gesztus) indítja el HANGGAL, és onnantól a böngésző a lejátszást engedi.
    // Natívon marad az azonnali autoplay.
    if (Platform.OS !== 'web') {
      setPlaying(true);
    }
    return () => setPlaying(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const duration = project ? projectDuration(project) : 0;

  const onHotspotPress = (clip: InteractiveClip) => {
    switch (clip.action.type) {
      case 'url': {
        const url = clip.action.url.trim();
        // üres/érvénytelen link: néma bukás helyett rövid visszajelzés
        if (!isValidActionUrl(url)) {
          Alert.alert(t('playerScreen.linkTitle'), t('playerScreen.linkInvalid'));
          break;
        }
        Linking.openURL(url).catch(() =>
          Alert.alert(t('playerScreen.linkTitle'), t('playerScreen.linkFailed'))
        );
        break;
      }
      case 'seek':
        setPlayhead(clip.action.toTime);
        setPlaying(true);
        break;
      case 'quiz':
        setPlaying(false);
        setAnswered(null);
        setQuiz(clip);
        break;
    }
  };

  const closeQuiz = () => {
    setQuiz(null);
    setPlaying(true);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.playerArea}>
        <PreviewSurface mode="play" onHotspotPress={onHotspotPress} />
        <AudioLayer />
        <Pressable onPress={() => router.back()} style={styles.closeButton} hitSlop={8}>
          <Ionicons name="close" size={22} color={palette.text} />
        </Pressable>
        {/* ▶️ Középső Play — állj/vége állapotban látszik. Weben ez a KOPPINTÁS az
            a felhasználói gesztus, ami feloldja a böngésző hangos-lejátszás tiltását
            (különben néma maradna); a quiz-modal a takarásával úgyis fölé kerül. */}
        {!isPlaying && quiz === null ? (
          <Pressable
            onPress={() => {
              if (playhead >= duration && duration > 0) {
                setPlayhead(0);
              }
              setPlaying(true);
            }}
            style={styles.centerPlay}
            accessibilityRole="button"
            accessibilityLabel={t('playerScreen.play')}
          >
            <Ionicons name="play" size={40} color="#fff" style={{ marginLeft: 5 }} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.controls}>
        <Pressable
          onPress={() => {
            if (!isPlaying && playhead >= duration && duration > 0) {
              setPlayhead(0);
            }
            setPlaying(!isPlaying);
          }}
          style={styles.playButton}
        >
          <Ionicons name={isPlaying ? 'pause' : 'play'} size={22} color={palette.text} />
        </Pressable>
        {/* 🔊 hangerő: az ikon némít/visszakapcsol, a csík húzva/koppintva állít (master) */}
        <Pressable
          onPress={() => setMasterVolume(masterVolume > 0 ? 0 : 1)}
          hitSlop={8}
          accessibilityLabel="Volume"
        >
          <Ionicons
            name={masterVolume === 0 ? 'volume-mute' : masterVolume < 0.5 ? 'volume-low' : 'volume-high'}
            size={20}
            color={palette.text}
          />
        </Pressable>
        <Pressable
          style={styles.volTrack}
          onPress={(e) => {
            const w = volWidth.value || 1;
            setMasterVolume(e.nativeEvent.locationX / w);
          }}
          onLayout={(e) => {
            volWidth.value = e.nativeEvent.layout.width;
          }}
        >
          <View style={styles.volTrackBg} />
          <View style={[styles.volFill, { width: `${Math.round(masterVolume * 100)}%` }]} />
        </Pressable>
        <Pressable
          style={styles.progressTrack}
          onPress={(e) => {
            const { locationX } = e.nativeEvent;
            const width = progressWidth.value || 1;
            setPlayhead((locationX / width) * duration);
          }}
          onLayout={(e) => {
            progressWidth.value = e.nativeEvent.layout.width;
          }}
        >
          <View
            style={[
              styles.progressFill,
              { width: duration > 0 ? `${(playhead / duration) * 100}%` : 0 },
            ]}
          />
        </Pressable>
        <Text style={styles.time}>
          {formatTime(playhead)} / {formatTime(duration)}
        </Text>
      </View>

      <Modal visible={quiz !== null} transparent animationType="fade">
        <View style={styles.quizBackdrop}>
          <View style={styles.quizCard}>
            {quiz && quiz.action.type === 'quiz' ? (
              <>
                <Text style={styles.quizQuestion}>{quiz.action.question}</Text>
                {quiz.action.answers.map((answer, index) => {
                  const correct =
                    quiz.action.type === 'quiz' && quiz.action.correctIndex === index;
                  const showResult = answered !== null;
                  return (
                    <Pressable
                      key={index}
                      disabled={showResult}
                      onPress={() => setAnswered(index)}
                      style={[
                        styles.quizAnswer,
                        showResult && correct && styles.quizCorrect,
                        showResult && answered === index && !correct && styles.quizWrong,
                      ]}
                    >
                      <Text style={styles.quizAnswerText}>{answer}</Text>
                    </Pressable>
                  );
                })}
                {answered !== null ? (
                  <>
                    <Text style={styles.quizResult}>
                      {quiz.action.correctIndex === answered
                        ? t('playerScreen.quizCorrect')
                        : t('playerScreen.quizWrong')}
                    </Text>
                    <Pressable onPress={closeQuiz} style={styles.quizContinue}>
                      <Text style={styles.quizContinueText}>{t('playerScreen.quizContinue')}</Text>
                    </Pressable>
                  </>
                ) : null}
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/** a progress-sáv mért szélessége (nem state — nem kell újrarender) */
const progressWidth = { value: 0 };
/** a hangerő-csík mért szélessége */
const volWidth = { value: 0 };

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  playerArea: {
    flex: 1,
  },
  closeButton: {
    position: 'absolute',
    top: 10,
    left: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#00000088',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerPlay: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -36,
    marginTop: -36,
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.92,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  playButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  volTrack: {
    width: 64,
    height: 20,
    justifyContent: 'center',
  },
  volTrackBg: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.surfaceHigh,
  },
  volFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.accent,
  },
  progressTrack: {
    flex: 1,
    height: 20,
    justifyContent: 'center',
  },
  progressFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.accent,
  },
  time: {
    color: palette.textDim,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  quizBackdrop: {
    flex: 1,
    backgroundColor: '#000000cc',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  quizCard: {
    width: '100%',
    backgroundColor: palette.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 20,
    gap: 10,
  },
  quizQuestion: {
    color: palette.text,
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 6,
  },
  quizAnswer: {
    backgroundColor: palette.surfaceHigh,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 12,
  },
  quizCorrect: {
    borderColor: palette.ok,
    backgroundColor: `${palette.ok}22`,
  },
  quizWrong: {
    borderColor: palette.danger,
    backgroundColor: `${palette.danger}22`,
  },
  quizAnswerText: {
    color: palette.text,
    fontSize: 14,
  },
  quizResult: {
    color: palette.textDim,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
  },
  quizContinue: {
    backgroundColor: palette.accent,
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
  },
  quizContinueText: {
    color: palette.text,
    fontWeight: '700',
  },
});
