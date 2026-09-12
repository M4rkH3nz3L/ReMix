import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AvatarSvg } from '@/components/AvatarSvg';
import { palette } from '@/constants/editor';
import { probeProvider } from '@/lib/aiHealth';
import {
  listAiProviders,
  listTaskAssignments,
  setTaskAssignment,
  type AiProvider,
  type AiTask,
} from '@/lib/aiProviders';

type Health = 'checking' | 'ok' | 'down';

/**
 * 🧑‍🎨💬 Karakter-választó egy AI-feladathoz — a chip-lista helyett a felhasználó
 * MODELLJEI a KARAKTEREIKKEL (avatar + név) jelennek meg csempeként; a kijelölt
 * karakter egy KILEBEGŐ (pop) chat-buborékban mutatkozik be, gépelő effekttel.
 * A választás feladatonként perzisztál (user_ai_task_providers). Provider híján
 * nem jelenik meg (marad az Auto/worker-AI).
 */
export function AiCharacterPicker({ task }: { task: AiTask }) {
  const { t } = useTranslation();
  const [models, setModels] = useState<AiProvider[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [intro, setIntro] = useState<{ provider: AiProvider; shown: number } | null>(null);
  const [health, setHealth] = useState<Record<string, Health>>({});

  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pop = useRef(new Animated.Value(0)).current;

  const stopTimer = () => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  };

  // a bemutatkozó buborék „kilebegtetése" + gépelés
  const playIntro = (p: AiProvider) => {
    const line = p.personaStory?.trim() || t('assistantPersona.hello', { name: p.personaName || p.label });
    stopTimer();
    setIntro({ provider: p, shown: 0 });
    pop.setValue(0);
    Animated.spring(pop, { toValue: 1, useNativeDriver: true, friction: 6, tension: 90 }).start();
    timer.current = setInterval(() => {
      setIntro((cur) => {
        if (!cur) {
          return cur;
        }
        const next = cur.shown + 1;
        if (next >= line.length) {
          stopTimer();
        }
        return { ...cur, shown: next };
      });
    }, 24);
  };

  useEffect(() => {
    let alive = true;
    Promise.all([listAiProviders(), listTaskAssignments()])
      .then(([list, tasks]) => {
        if (!alive) {
          return;
        }
        setModels(list);
        const id = tasks[task] ?? null;
        setSelected(id);
        const active = id ? list.find((x) => x.id === id) : null;
        // a kijelölt karakter rögtön bemutatkozik (ha van karaktere)
        if (active && (active.avatar || active.personaName)) {
          playIntro(active);
        }
        // 🟢 health-próba providerenként (a worker /ai/probe-on át)
        setHealth(Object.fromEntries(list.map((m) => [m.id, 'checking' as Health])));
        for (const m of list) {
          probeProvider(m)
            .then((ok) => {
              if (alive) {
                setHealth((h) => ({ ...h, [m.id]: ok ? 'ok' : 'down' }));
              }
            })
            .catch(() => {
              if (alive) {
                setHealth((h) => ({ ...h, [m.id]: 'down' }));
              }
            });
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
      stopTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task]);

  const choose = (id: string | null) => {
    // elérhetetlen modellt nem lehet kijelölni
    if (id && health[id] === 'down') {
      return;
    }
    setSelected(id);
    setTaskAssignment(task, id).catch(() => {});
    const p = id ? models.find((x) => x.id === id) : null;
    if (p && (p.avatar || p.personaName)) {
      playIntro(p);
    } else {
      stopTimer();
      setIntro(null);
    }
  };

  if (models.length === 0) {
    return null;
  }

  const line = intro
    ? intro.provider.personaStory?.trim() ||
      t('assistantPersona.hello', { name: intro.provider.personaName || intro.provider.label })
    : '';

  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {/* Auto */}
        <Pressable style={styles.tile} onPress={() => choose(null)}>
          <View style={[styles.autoAvatar, !selected ? styles.avatarActive : null]}>
            <Ionicons name="flash-outline" size={22} color={!selected ? palette.accent : palette.textDim} />
          </View>
          <Text style={[styles.tileName, !selected ? styles.tileNameActive : null]} numberOfLines={1}>
            {t('aiPicker.auto')}
          </Text>
        </Pressable>

        {/* karakterek */}
        {models.map((m) => {
          const on = selected === m.id;
          const hs = health[m.id] ?? 'checking';
          const down = hs === 'down';
          return (
            <Pressable
              key={m.id}
              style={[styles.tile, down ? styles.tileDown : null]}
              disabled={down}
              onPress={() => choose(m.id)}
            >
              <View style={styles.avatarBox}>
                <View style={[styles.avatarWrap, on ? styles.avatarActive : null]}>
                  <AvatarSvg config={m.avatar} size={48} />
                </View>
                <View
                  style={[
                    styles.dot,
                    hs === 'ok' ? styles.dotOk : hs === 'down' ? styles.dotDown : styles.dotChecking,
                  ]}
                />
              </View>
              <Text style={[styles.tileName, on ? styles.tileNameActive : null]} numberOfLines={1}>
                {m.personaName || m.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {intro ? (
        <Animated.View
          style={[
            styles.bubbleRow,
            {
              opacity: pop,
              transform: [
                { translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
                { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
              ],
            },
          ]}
        >
          <AvatarSvg config={intro.provider.avatar} size={28} />
          <View style={styles.bubble}>
            <Text style={styles.bubbleText}>
              {line.slice(0, intro.shown)}
              {intro.shown < line.length ? '▋' : ''}
            </Text>
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10, marginBottom: 6 },
  row: { gap: 12, paddingVertical: 2, paddingRight: 8 },
  tile: { alignItems: 'center', width: 60, gap: 4 },
  tileDown: { opacity: 0.45 },
  avatarBox: { width: 54, height: 54, alignItems: 'center', justifyContent: 'center' },
  dot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: palette.surface,
  },
  dotOk: { backgroundColor: palette.ok },
  dotDown: { backgroundColor: palette.danger },
  dotChecking: { backgroundColor: palette.textDim },
  avatarWrap: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  autoAvatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: palette.surfaceHigh,
  },
  avatarActive: { borderColor: palette.accent },
  tileName: { color: palette.textDim, fontSize: 10, maxWidth: 60, textAlign: 'center' },
  tileNameActive: { color: palette.text, fontWeight: '700' },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingRight: 20 },
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
