import { Ionicons } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Chip, PanelSection, PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { makeId } from '@/lib/id';
import { pickVideo } from '@/lib/media';
import {
  type MulticamCut,
  multicamSegments,
  syncByWaveform,
} from '@/lib/multicam';
import { trackEnd, trackOf } from '@/lib/projectUtils';
import { getWaveform } from '@/lib/waveform';
import { useEditorStore } from '@/store/editorStore';
import type { Asset } from '@/types/project';

interface Angle {
  uri: string;
  name: string;
  duration: number;
  width: number;
  height: number;
  /** eltolás a referenciához (0. szög) képest, mp — a syncByWaveform adja */
  offset: number;
}

const ANGLE_COLORS = ['#7c5cff', '#ff2ea6', '#4dd97a', '#5a9dff', '#ffd166', '#ff6b4a'];
const MAX_ANGLES = 6;

/**
 * 🎬 Multicam builder: több kameraszög hozzáadása → hang-alapú szinkron
 * (waveform) → élő szögváltás (a lejátszás közben a szögre koppintva vágást
 * rögzít) → multicam-szekvencia létrehozása (néma videóklipek + folytonos
 * master-audio). A 0. (referencia) szög a master: az ő hangja szól végig.
 */
export function MulticamPanel() {
  const { t } = useTranslation();
  const setPanel = useEditorStore((s) => s.setPanel);

  const [angles, setAngles] = useState<Angle[]>([]);
  const [selected, setSelected] = useState(0);
  const [cuts, setCuts] = useState<MulticamCut[]>([]);
  const [playing, setPlaying] = useState(false);
  const [masterTime, setMasterTime] = useState(0);
  const [busy, setBusy] = useState<'sync' | 'create' | null>(null);

  const player = useVideoPlayer(null);
  const clockRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const masterDuration = angles[0]?.duration ?? 0;

  // a kiválasztott szög forrása + tekerés a szinkronizált időre
  useEffect(() => {
    const a = angles[selected];
    if (!a) {
      return;
    }
    const src = a.uri;
    player
      .replaceAsync({ uri: src })
      .then(() => {
        player.currentTime = Math.max(0, masterTime + a.offset);
        if (playing) {
          player.play();
        }
      })
      .catch(() => {});
    // szándékosan csak a szög-váltásra fut (a masterTime tekerést a scrub végzi)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, angles.length]);

  // lejátszás-óra: a player idejéből visszaszámolt master-idő
  useEffect(() => {
    if (!playing) {
      if (clockRef.current) {
        clearInterval(clockRef.current);
        clockRef.current = null;
      }
      return;
    }
    clockRef.current = setInterval(() => {
      const a = angles[selected];
      if (!a) {
        return;
      }
      const mt = player.currentTime - a.offset;
      if (mt >= masterDuration) {
        setPlaying(false);
        setMasterTime(masterDuration);
        player.pause();
        return;
      }
      setMasterTime(Math.max(0, mt));
    }, 150);
    return () => {
      if (clockRef.current) {
        clearInterval(clockRef.current);
        clockRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, selected, masterDuration, angles]);

  const addAngle = async () => {
    if (angles.length >= MAX_ANGLES) {
      return;
    }
    const picked = await pickVideo();
    if (!picked) {
      return;
    }
    setAngles((prev) => [
      ...prev,
      {
        uri: picked.uri,
        name: t('panels.multicam.angleN', { n: prev.length + 1 }),
        duration: picked.duration > 0 ? picked.duration : 5,
        width: picked.width,
        height: picked.height,
        offset: 0,
      },
    ]);
  };

  const removeAngle = (idx: number) => {
    setAngles((prev) => prev.filter((_, i) => i !== idx));
    setCuts([]);
    setSelected(0);
  };

  /** a kiválasztott szöget referenciává (master, 0. index) teszi → újra kell szinkronizálni */
  const makeMaster = (idx: number) => {
    if (idx === 0) {
      return;
    }
    setAngles((prev) => {
      const next = [...prev];
      const [m] = next.splice(idx, 1);
      next.unshift({ ...m, offset: 0 });
      return next.map((a) => ({ ...a, offset: 0 }));
    });
    setCuts([]);
    setSelected(0);
  };

  const autoSync = async () => {
    if (angles.length < 2) {
      return;
    }
    setBusy('sync');
    try {
      const waves = await Promise.all(angles.map((a) => getWaveform(a.uri)));
      const usable = waves.map((w) => ({
        peaks: w?.peaks ?? [],
        peaksPerSecond: w?.peaksPerSecond ?? 10,
      }));
      if (usable.some((w) => w.peaks.length < 2)) {
        Alert.alert(t('panels.multicam.title'), t('panels.multicam.syncFail'));
        return;
      }
      const offsets = syncByWaveform(usable);
      setAngles((prev) => prev.map((a, i) => ({ ...a, offset: offsets[i] ?? 0 })));
    } finally {
      setBusy(null);
    }
  };

  const togglePlay = () => setPlaying((p) => !p);

  const pickAngle = (idx: number) => {
    // élő szögváltás: vágás rögzítése az aktuális master-időnél + a szög mutatása
    if (idx !== selected) {
      setCuts((prev) => [...prev, { t: Math.round(masterTime * 100) / 100, angle: idx }]);
    }
    setSelected(idx);
  };

  const undoCut = () => setCuts((prev) => prev.slice(0, -1));
  const clearCuts = () => setCuts([]);

  const createSequence = () => {
    const state = useEditorStore.getState();
    const project = state.project;
    if (!project || angles.length < 2) {
      return;
    }
    setBusy('create');
    try {
      const offsets = angles.map((a) => a.offset);
      const durations = angles.map((a) => a.duration);
      const segs = multicamSegments(cuts, offsets, masterDuration, durations);
      if (segs.length === 0) {
        Alert.alert(t('panels.multicam.title'), t('panels.multicam.noCuts'));
        return;
      }
      const base = trackEnd(trackOf(project, 'video'));
      // néma videóklipek a fő sávra (a szögek a szinkronizált forrás-időről)
      for (const seg of segs) {
        const a = angles[seg.angle];
        const assetId = makeId('ast');
        const asset: Asset = {
          id: assetId,
          kind: 'video',
          uri: a.uri,
          provider: 'local',
          duration: a.duration,
          width: a.width,
          height: a.height,
        };
        state.addClip(
          'video',
          {
            kind: 'video',
            id: makeId('clip'),
            start: Math.round((base + seg.start) * 1000) / 1000,
            duration: seg.duration,
            uri: a.uri,
            assetId,
            trimIn: seg.srcIn,
            sourceDuration: a.duration,
            speed: 1,
            volume: 0, // néma — a master-audio szól végig
            filterId: 'none',
          },
          asset
        );
      }
      // folytonos master-audio a 0. (referencia) szögből
      const master = angles[0];
      state.addClip(
        'voiceover',
        {
          kind: 'audio',
          id: makeId('clip'),
          start: Math.round(base * 1000) / 1000,
          duration: masterDuration,
          uri: master.uri,
          label: t('panels.multicam.masterAudio'),
          volume: 1,
          fadeIn: 0,
          fadeOut: 0,
          source: 'imported',
        },
        {
          id: makeId('ast'),
          kind: 'audio',
          uri: master.uri,
          provider: 'local',
          duration: master.duration,
        }
      );
      setPanel(null);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View>
      <PanelSection title={t('panels.multicam.anglesTitle')}>
        {angles.map((a, i) => (
          <View key={i} style={styles.angleRow}>
            <View style={[styles.dot, { backgroundColor: ANGLE_COLORS[i % ANGLE_COLORS.length] }]} />
            <Text style={styles.angleName}>
              {a.name}
              {i === 0 ? ` · ${t('panels.multicam.master')}` : ''}
            </Text>
            <Text style={styles.angleMeta}>
              {a.duration.toFixed(1)}s{i > 0 && a.offset !== 0 ? ` · ${a.offset > 0 ? '+' : ''}${a.offset.toFixed(2)}s` : ''}
            </Text>
            {i > 0 ? (
              <Pressable hitSlop={6} onPress={() => makeMaster(i)} style={styles.iconBtn}>
                <Ionicons name="star-outline" size={16} color={palette.textDim} />
              </Pressable>
            ) : null}
            <Pressable hitSlop={6} onPress={() => removeAngle(i)} style={styles.iconBtn}>
              <Ionicons name="close" size={16} color={palette.danger} />
            </Pressable>
          </View>
        ))}
        {angles.length < MAX_ANGLES ? (
          <Chip label={t('panels.multicam.addAngle')} active={false} onPress={() => void addAngle()} />
        ) : null}
        {angles.length >= 2 ? (
          <PrimaryButton
            icon="git-compare-outline"
            label={busy === 'sync' ? t('panels.multicam.syncing') : t('panels.multicam.autoSync')}
            onPress={() => void autoSync()}
          />
        ) : null}
        <Text style={styles.note}>{t('panels.multicam.anglesNote')}</Text>
      </PanelSection>

      {angles.length >= 2 ? (
        <PanelSection title={t('panels.multicam.liveTitle')}>
          <View style={styles.stage}>
            <VideoView player={player} style={styles.video} contentFit="contain" nativeControls={false} />
          </View>
          <View style={styles.transportRow}>
            <Pressable hitSlop={8} onPress={togglePlay} style={styles.playBtn}>
              <Ionicons name={playing ? 'pause' : 'play'} size={20} color={palette.text} />
            </Pressable>
            <Text style={styles.time}>
              {masterTime.toFixed(1)} / {masterDuration.toFixed(1)}s
            </Text>
          </View>
          <View style={styles.angleGrid}>
            {angles.map((_a, i) => (
              <Pressable
                key={i}
                onPress={() => pickAngle(i)}
                style={[
                  styles.angleBtn,
                  { borderColor: ANGLE_COLORS[i % ANGLE_COLORS.length] },
                  selected === i ? { backgroundColor: ANGLE_COLORS[i % ANGLE_COLORS.length] } : null,
                ]}
              >
                <Text style={[styles.angleBtnText, selected === i ? styles.angleBtnTextOn : null]}>
                  {i + 1}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.cutRow}>
            <Text style={styles.note}>{t('panels.multicam.cutsCount', { count: cuts.length })}</Text>
            <View style={{ flex: 1 }} />
            <Pressable hitSlop={6} onPress={undoCut} disabled={!cuts.length} style={styles.iconBtn}>
              <Ionicons name="arrow-undo-outline" size={18} color={cuts.length ? palette.text : palette.border} />
            </Pressable>
            <Pressable hitSlop={6} onPress={clearCuts} disabled={!cuts.length} style={styles.iconBtn}>
              <Ionicons name="trash-outline" size={18} color={cuts.length ? palette.danger : palette.border} />
            </Pressable>
          </View>
          <Text style={styles.note}>{t('panels.multicam.liveNote')}</Text>
        </PanelSection>
      ) : null}

      {angles.length >= 2 ? (
        <PanelSection title={t('panels.multicam.buildTitle')}>
          <PrimaryButton
            icon="film-outline"
            label={busy === 'create' ? t('panels.multicam.creating') : t('panels.multicam.create')}
            onPress={createSequence}
          />
          <Text style={styles.note}>{t('panels.multicam.buildNote')}</Text>
        </PanelSection>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  angleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  angleName: { color: palette.text, fontSize: 13, fontWeight: '600' },
  angleMeta: { color: palette.textDim, fontSize: 11, flex: 1, fontVariant: ['tabular-nums'] },
  iconBtn: { padding: 4 },
  note: { color: palette.textDim, fontSize: 11, lineHeight: 16, marginTop: 4 },
  stage: {
    height: 180,
    backgroundColor: '#000',
    borderRadius: 12,
    overflow: 'hidden',
  },
  video: { width: '100%', height: '100%' },
  transportRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  playBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: palette.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  time: { color: palette.textDim, fontSize: 12, fontVariant: ['tabular-nums'] },
  angleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  angleBtn: {
    width: 48,
    height: 48,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surface,
  },
  angleBtnText: { color: palette.text, fontSize: 18, fontWeight: '800' },
  angleBtnTextOn: { color: '#fff' },
  cutRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
});
