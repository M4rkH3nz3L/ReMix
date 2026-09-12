import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AvatarSvg } from '@/components/AvatarSvg';
import { palette } from '@/constants/editor';
import {
  listAiProviders,
  listTaskAssignments,
  type AiProvider,
  type AiTask,
} from '@/lib/aiProviders';

/**
 * 💬 Asszisztens-persona — az AI-panelen megmutatja, KI a kiválasztott karakter
 * (avatar + név) egy adott feladathoz, és rákoppintva CHAT-buborékban „kiírja" a
 * bemutatkozását, gépelő (typewriter) effekttel — mintha csetelne. Csak akkor
 * jelenik meg, ha a kiválasztott modellnek van karaktere (avatar vagy név).
 */
export function AssistantPersona({ task = 'assistant' as AiTask }: { task?: AiTask }) {
  const { t } = useTranslation();
  const [provider, setProvider] = useState<AiProvider | null>(null);
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // a feladathoz aktív provider: hozzárendelt → az; különben az alapértelmezett
  useEffect(() => {
    let alive = true;
    Promise.all([listAiProviders(), listTaskAssignments()])
      .then(([list, tasks]) => {
        if (!alive) {
          return;
        }
        const id = tasks[task];
        const p = (id ? list.find((x) => x.id === id) : null) ?? list.find((x) => x.isDefault) ?? null;
        setProvider(p);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [task]);

  // interval-takarítás lecsatoláskor
  useEffect(
    () => () => {
      if (timer.current) {
        clearInterval(timer.current);
      }
    },
    []
  );

  if (!provider) {
    return null;
  }
  const name = provider.personaName || provider.label;
  const hasCharacter = !!provider.avatar || !!provider.personaName;
  if (!hasCharacter) {
    return null;
  }
  const line = provider.personaStory?.trim() || t('assistantPersona.hello', { name });

  const startTyping = () => {
    if (timer.current) {
      clearInterval(timer.current);
    }
    setShown(0);
    timer.current = setInterval(() => {
      setShown((s) => {
        const next = s + 1;
        if (next >= line.length && timer.current) {
          clearInterval(timer.current);
          timer.current = null;
        }
        return next;
      });
    }, 24);
  };

  const onTap = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      startTyping();
    } else if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  };

  return (
    <View style={styles.wrap}>
      <Pressable style={styles.head} onPress={onTap} accessibilityRole="button">
        <AvatarSvg config={provider.avatar} size={40} />
        <View style={styles.headText}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.hint} numberOfLines={1}>
            {open ? t('assistantPersona.hide') : t('assistantPersona.tapToMeet')}
          </Text>
        </View>
      </Pressable>

      {open ? (
        <View style={styles.bubbleRow}>
          <AvatarSvg config={provider.avatar} size={26} />
          <View style={styles.bubble}>
            <Text style={styles.bubbleText}>
              {line.slice(0, shown)}
              {shown < line.length ? '▋' : ''}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, marginBottom: 8 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceHigh,
  },
  headText: { flex: 1 },
  name: { color: palette.text, fontSize: 14, fontWeight: '700' },
  hint: { color: palette.textDim, fontSize: 11 },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingRight: 24 },
  bubble: {
    flex: 1,
    backgroundColor: palette.accentSoft,
    borderColor: palette.accent,
    borderWidth: 1,
    borderRadius: 14,
    borderBottomLeftRadius: 3,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  bubbleText: { color: palette.text, fontSize: 13, lineHeight: 19 },
});
