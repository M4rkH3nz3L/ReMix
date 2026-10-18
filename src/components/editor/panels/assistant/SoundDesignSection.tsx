import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { Chip, PanelSection, PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { detectBeats, timelineBeats } from '@/lib/beats';
import { makeId } from '@/lib/id';
import { downloadTrack, fetchSoundLibrary } from '@/lib/render';
import { planSoundDesign, usedSfxIds } from '@/lib/soundDesign';
import type { SfxId, SfxPlacement } from '@/lib/soundDesign';
import { useEditorStore } from '@/store/editorStore';

/**
 * 🔊 Sound Design AI v1: a vágópontokra és a beat-rácsra oszt ki SFX-eket a
 * worker generált könyvtárából (whoosh/bassdrop/riser/pop). A terv pure
 * (soundDesign.ts), itt csak a jelek összegyűjtése, a fájlok letöltése és a
 * sávra rakás megy — egy undo-lépésben. Önálló AI-mód; a közös busy-sávot a
 * panel adja (`busy`/`setBusy`).
 */
export function SoundDesignSection({
  busy,
  setBusy,
}: {
  busy: string | null;
  setBusy: (status: string | null) => void;
}) {
  const { t } = useTranslation();
  const [sfxPunch, setSfxPunch] = useState<'subtle' | 'normal' | 'punchy'>('normal');

  const runSoundDesign = async () => {
    const state = useEditorStore.getState();
    if (!state.project || busy) {
      return;
    }
    const project = state.project;
    const videoClips = project.tracks
      .filter((t) => t.type === 'video')
      .flatMap((t) => t.clips)
      .sort((a, b) => a.start - b.start);
    if (videoClips.length === 0) {
      Alert.alert(t('panels.assistant.soundDesignTitle'), t('panels.assistant.soundDesignNeedsVideo'));
      return;
    }

    setBusy(t('panels.assistant.analyzing'));
    try {
      // vágópontok: minden klip-kezdet az első után
      const cuts = videoClips.slice(1).map((c) => c.start);
      // hangsúlyok: felirat- és overlay-megjelenések
      const accents = project.tracks
        .filter((t) => t.type === 'captions' || t.type === 'overlay')
        .flatMap((t) => t.clips)
        .map((c) => c.start);

      // beat-rács, ha van zene (enélkül is dolgozunk, csak vágásra)
      let beats: number[] = [];
      let downbeats: number[] = [];
      const musicClip = project.tracks
        .filter((t) => t.type === 'music')
        .flatMap((t) => t.clips)
        .filter((c) => c.kind === 'audio')
        .sort((a, b) => a.start - b.start)[0];
      if (musicClip && musicClip.kind === 'audio') {
        setBusy(t('panels.assistant.beatAnalysis'));
        const grid = await detectBeats(musicClip.uri);
        if (grid && grid.bpm > 0) {
          beats = timelineBeats(musicClip, grid.beats);
          downbeats = timelineBeats(musicClip, grid.downbeats);
        }
      }

      const duration = Math.max(
        ...project.tracks.flatMap((t) => t.clips.map((c) => c.start + c.duration)),
        0
      );
      const plan = planSoundDesign(
        { cuts, beats, downbeats, accents, duration },
        { intensity: sfxPunch }
      );
      if (plan.length === 0) {
        Alert.alert(
          t('panels.assistant.soundDesignTitle'),
          t('panels.assistant.soundDesignNoPoints')
        );
        return;
      }

      // a szükséges SFX-fájlok letöltése (mindegyik csak egyszer)
      setBusy(t('panels.assistant.downloadingSounds'));
      const library = await fetchSoundLibrary();
      const uriById = new Map<SfxId, { uri: string; name: string }>();
      for (const id of usedSfxIds(plan)) {
        const track = library.find((t) => t.id === id);
        if (!track) {
          continue;
        }
        try {
          uriById.set(id, { uri: await downloadTrack(track), name: track.name });
        } catch {
          // ez az egy SFX kimarad, a többi mehet
        }
      }
      setBusy(null);
      if (uriById.size === 0) {
        Alert.alert(t('panels.assistant.soundDesignTitle'), t('panels.assistant.soundLibraryUnavailable'));
        return;
      }

      const usable = plan.filter((p) => uriById.has(p.sfxId));
      const sfxTrack = project.tracks.find((t) => t.type === 'sfx');
      const summary = usable.reduce<Record<string, number>>((acc, p) => {
        acc[p.reason] = (acc[p.reason] ?? 0) + 1;
        return acc;
      }, {});
      const lines = Object.entries(summary).map(([r, n]) => `· ${n}× ${r}`);

      Alert.alert(
        t('panels.assistant.soundDesignTitle'),
        t('panels.assistant.soundDesignBody', {
          count: usable.length,
          lines: lines.join('\n'),
        }) +
          (beats.length > 0
            ? t('panels.assistant.soundDesignWithBeats')
            : t('panels.assistant.soundDesignNoBeats')) +
          t('panels.assistant.soundDesignKeepUndo'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('panels.assistant.applyAction'),
            onPress: () => {
              const newClips = usable.map((p: SfxPlacement) => {
                const entry = uriById.get(p.sfxId)!;
                return {
                  kind: 'audio' as const,
                  id: makeId('clip'),
                  start: Math.round(p.start * 1000) / 1000,
                  duration: p.duration,
                  uri: entry.uri,
                  label: `${entry.name} — ${p.reason}`,
                  volume: p.volume,
                  fadeIn: 0,
                  fadeOut: Math.min(0.12, p.duration / 3),
                  source: 'imported' as const,
                };
              });
              useEditorStore.getState().dispatch(
                {
                  type: 'REPLACE_TRACK_CLIPS',
                  trackType: 'sfx',
                  clips: [...(sfxTrack?.clips ?? []), ...newClips].sort(
                    (a, b) => a.start - b.start
                  ),
                },
                'ai'
              );
            },
          },
        ]
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <PanelSection title={t('panels.assistant.sectionSoundDesign')}>
      <View style={styles.row}>
        {(
          [
            { id: 'subtle', label: t('panels.assistant.intensitySubtle') },
            { id: 'normal', label: t('panels.assistant.intensityNormal') },
            { id: 'punchy', label: t('panels.assistant.intensityPunchy') },
          ] as const
        ).map((opt) => (
          <Chip
            key={opt.id}
            label={opt.label}
            active={sfxPunch === opt.id}
            onPress={() => setSfxPunch(opt.id)}
          />
        ))}
      </View>
      <PrimaryButton
        icon="volume-high-outline"
        label={busy ?? t('panels.assistant.soundDesignBtn')}
        onPress={() => {
          runSoundDesign().catch((err: Error) =>
            Alert.alert(t('panels.assistant.soundDesignTitle'), err.message)
          );
        }}
      />
      <Text style={styles.note}>{t('panels.assistant.soundDesignNote')}</Text>
    </PanelSection>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 8,
  },
});
