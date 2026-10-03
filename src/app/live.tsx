import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/editor';
import { listLiveNow, subscribeLiveList, type LiveSession } from '@/lib/live';
import { createEmptyProject } from '@/lib/projectUtils';
import { saveProject } from '@/lib/storage';

/**
 * 🔴 Élő-képernyő (hub) — a feed felső sorának ÉLŐ-ikonja nyitja. Valódi
 * „most élőben" lista (Supabase + realtime) + „Élő indítása" (session-létrehozás
 * → room). A videó-transzportot provider adja majd; a session/realtime-mag él.
 */
export default function LiveScreen() {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<LiveSession[] | null>(null);

  const reload = () => {
    listLiveNow()
      .then(setLive)
      .catch(() => setLive([]));
  };
  useEffect(() => {
    let active = true;
    listLiveNow()
      .then((l) => active && setLive(l))
      .catch(() => active && setLive([]));
    const unsub = subscribeLiveList(() => active && reload());
    return () => {
      active = false;
      unsub();
    };
  }, []);

  const onGoLive = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      // 🎥 a „Go live" ELŐSZÖR a Live Studiót (OBS-szerű kompozitort) nyitja —
      // ott épül fel az adás (jelenetek/források/célok), és onnan megy adásba a
      // „Start streaming" (LIVE.md Fázis A). Egy `kind: 'live'` projekt hordozza.
      const name = title.trim() || t('live.defaultTitle');
      const project = createEmptyProject(name, '9:16', undefined, 'live');
      await saveProject(project);
      setTitle('');
      router.push(`/live/studio/${project.id}`);
    } catch {
      // mentés/létrehozás hiba — csendben (a gomb újra aktív)
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={palette.text} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {t('live.title')}
        </Text>
        <View style={styles.livePill}>
          <View style={styles.liveDot} />
          <Text style={styles.livePillText}>{t('live.title').toUpperCase()}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {/* 🎬 Élő indítása — hero-kártya */}
        <LinearGradient
          colors={['#241a3a', '#0c0d12']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.heroIcon}>
            <Ionicons name="radio" size={30} color="#fff" />
          </View>
          <Text style={styles.heroTitle}>{t('live.heroTitle')}</Text>
          <Text style={styles.heroBody}>{t('live.heroBody')}</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder={t('live.titlePlaceholder')}
            placeholderTextColor="#ffffff88"
            style={styles.titleInput}
            maxLength={120}
            editable={!busy}
          />
          <Pressable
            style={[styles.goLiveBtn, busy && { opacity: 0.6 }]}
            onPress={onGoLive}
            disabled={busy}
            accessibilityRole="button"
          >
            <Ionicons name="videocam" size={18} color="#fff" />
            <Text style={styles.goLiveText}>{t('live.goLive')}</Text>
          </Pressable>
        </LinearGradient>

        {/* 📡 Most élőben */}
        <Text style={styles.sectionTitle}>{t('live.nowTitle')}</Text>
        {live == null ? (
          <ActivityIndicator color={palette.accent} style={{ marginTop: 16 }} />
        ) : live.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="radio-outline" size={40} color={palette.border} />
            <Text style={styles.emptyText}>{t('live.empty')}</Text>
          </View>
        ) : (
          live.map((s) => (
            <Pressable key={s.id} style={styles.liveCard} onPress={() => router.push(`/live/${s.id}`)}>
              {s.hostAvatar ? (
                <Image source={{ uri: s.hostAvatar }} style={styles.liveAvatar} />
              ) : (
                <View style={[styles.liveAvatar, styles.liveAvatarFallback]}>
                  <Ionicons name="person" size={20} color={palette.textDim} />
                </View>
              )}
              <View style={styles.liveCardBody}>
                <Text style={styles.liveCardHost} numberOfLines={1}>
                  {s.hostName || s.hostUsername || '—'}
                </Text>
                <Text style={styles.liveCardTitle} numberOfLines={1}>
                  {s.title}
                </Text>
              </View>
              <View style={styles.liveBadge}>
                <View style={styles.liveDot} />
                <Text style={styles.liveBadgeText}>{t('live.title').toUpperCase()}</Text>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  backBtn: { padding: 4 },
  headerTitle: { color: palette.text, fontSize: 18, fontWeight: '800', flex: 1 },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: palette.danger,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#fff' },
  livePillText: { color: '#fff', fontSize: 11, fontWeight: '900', letterSpacing: 0.6 },

  body: { padding: 16, gap: 18 },
  hero: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 22,
    alignItems: 'center',
    gap: 10,
  },
  heroIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: palette.danger,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  heroTitle: { color: '#fff', fontSize: 20, fontWeight: '900', textAlign: 'center' },
  heroBody: { color: '#ffffffcc', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  titleInput: {
    alignSelf: 'stretch',
    marginTop: 6,
    backgroundColor: '#ffffff1a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ffffff33',
    color: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  goLiveBtn: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: palette.accent,
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  goLiveText: { color: '#fff', fontSize: 15, fontWeight: '800' },

  sectionTitle: { color: palette.text, fontSize: 15, fontWeight: '800' },
  emptyCard: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 40,
    paddingHorizontal: 24,
    backgroundColor: palette.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
  },
  emptyText: { color: palette.textDim, fontSize: 14, textAlign: 'center', lineHeight: 20 },

  liveCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: palette.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 12,
  },
  liveAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: palette.bg },
  liveAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  liveCardBody: { flex: 1 },
  liveCardHost: { color: palette.text, fontSize: 15, fontWeight: '800' },
  liveCardTitle: { color: palette.textDim, fontSize: 13, marginTop: 2 },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: palette.danger,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  liveBadgeText: { color: '#fff', fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
});
