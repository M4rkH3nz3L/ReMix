import { StyleSheet, TextInput, View } from 'react-native';

import { Chip, PanelSection, Stepper } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { clamp, formatTime } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { HotspotAction, InteractiveClip } from '@/types/project';

/**
 * Hotspot-panel: a kattintható terület felirata, időtartama és művelete
 * (URL-megnyitás / ugrás egy időpontra / kvíz). A terület magán az előnézeten
 * húzható-méretezhető.
 */
export function HotspotPanel({ clip }: { clip: InteractiveClip }) {
  const updateClip = useEditorStore((s) => s.updateClip);

  const setAction = (action: HotspotAction) => updateClip(clip.id, { action });

  const switchType = (type: HotspotAction['type']) => {
    if (type === clip.action.type) {
      return;
    }
    if (type === 'url') {
      setAction({ type: 'url', url: 'https://' });
    } else if (type === 'seek') {
      setAction({ type: 'seek', toTime: 0 });
    } else {
      setAction({
        type: 'quiz',
        question: 'Mi a kérdés?',
        answers: ['Válasz A', 'Válasz B', 'Válasz C'],
        correctIndex: 0,
      });
    }
  };

  return (
    <View>
      <PanelSection title="Felirat">
        <TextInput
          value={clip.label}
          onChangeText={(label) => updateClip(clip.id, { label })}
          style={styles.input}
          placeholder="Pl. Vásárolj most"
          placeholderTextColor={palette.textDim}
        />
        <Stepper
          label="Időtartam"
          value={`${clip.duration.toFixed(1)} mp`}
          onDec={() => updateClip(clip.id, { duration: clamp(clip.duration - 0.5, 0.5, 600) })}
          onInc={() => updateClip(clip.id, { duration: clamp(clip.duration + 0.5, 0.5, 600) })}
        />
      </PanelSection>

      <PanelSection title="Művelet">
        <View style={styles.row}>
          <Chip label="URL" active={clip.action.type === 'url'} onPress={() => switchType('url')} />
          <Chip
            label="Ugrás"
            active={clip.action.type === 'seek'}
            onPress={() => switchType('seek')}
          />
          <Chip
            label="Kvíz"
            active={clip.action.type === 'quiz'}
            onPress={() => switchType('quiz')}
          />
        </View>

        {clip.action.type === 'url' ? (
          <TextInput
            value={clip.action.url}
            onChangeText={(url) => setAction({ type: 'url', url })}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://…"
            placeholderTextColor={palette.textDim}
          />
        ) : null}

        {clip.action.type === 'seek' ? (
          <Stepper
            label={`Ugrás ide: ${formatTime(clip.action.toTime)}`}
            value={`${clip.action.toTime.toFixed(1)} mp`}
            onDec={() =>
              setAction({
                type: 'seek',
                toTime: clamp(
                  (clip.action.type === 'seek' ? clip.action.toTime : 0) - 1,
                  0,
                  36000
                ),
              })
            }
            onInc={() =>
              setAction({
                type: 'seek',
                toTime: clamp(
                  (clip.action.type === 'seek' ? clip.action.toTime : 0) + 1,
                  0,
                  36000
                ),
              })
            }
          />
        ) : null}

        {clip.action.type === 'quiz' ? (
          <View style={{ gap: 8 }}>
            <TextInput
              value={clip.action.question}
              onChangeText={(question) =>
                clip.action.type === 'quiz' &&
                setAction({ ...clip.action, question })
              }
              style={styles.input}
              placeholder="Kérdés"
              placeholderTextColor={palette.textDim}
            />
            {clip.action.answers.map((answer, index) => (
              <View key={index} style={styles.answerRow}>
                <Chip
                  label={clip.action.type === 'quiz' && clip.action.correctIndex === index ? '✓' : `${index + 1}.`}
                  active={clip.action.type === 'quiz' && clip.action.correctIndex === index}
                  onPress={() =>
                    clip.action.type === 'quiz' &&
                    setAction({ ...clip.action, correctIndex: index })
                  }
                />
                <TextInput
                  value={answer}
                  onChangeText={(text) => {
                    if (clip.action.type !== 'quiz') {
                      return;
                    }
                    const answers = [...clip.action.answers];
                    answers[index] = text;
                    setAction({ ...clip.action, answers });
                  }}
                  style={[styles.input, { flex: 1 }]}
                  placeholder={`Válasz ${index + 1}`}
                  placeholderTextColor={palette.textDim}
                />
              </View>
            ))}
          </View>
        ) : null}
      </PanelSection>
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: palette.surfaceHigh,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.text,
    padding: 10,
    fontSize: 14,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  answerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
