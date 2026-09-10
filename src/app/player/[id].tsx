import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Linking,
  Modal,
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
    loadProject(id)
      .then((loaded) => {
        if (loaded) {
          useEditorStore.getState().loadProject(loaded);
        }
      })
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    // belépéskor elölről indítunk
    setPlayhead(0);
    setPlaying(true);
    return () => setPlaying(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const duration = project ? projectDuration(project) : 0;

  const onHotspotPress = (clip: InteractiveClip) => {
    switch (clip.action.type) {
      case 'url':
        Linking.openURL(clip.action.url).catch(() => {});
        break;
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
                        ? 'Helyes válasz! 🎉'
                        : 'Nem talált — nézd meg a helyes választ!'}
                    </Text>
                    <Pressable onPress={closeQuiz} style={styles.quizContinue}>
                      <Text style={styles.quizContinueText}>Tovább</Text>
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
