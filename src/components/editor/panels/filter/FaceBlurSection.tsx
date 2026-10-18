import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { Chip, PanelSection, Stepper } from '@/components/ui/controls';
import { aspectValue, palette } from '@/constants/editor';
import { faceUnionRegion, fetchFaces } from '@/lib/faceClient';
import { clamp } from '@/lib/time';
import { trackSubject } from '@/lib/track';
import { useEditorStore } from '@/store/editorStore';
import type { ImageClip, VideoClip } from '@/types/project';

/**
 * 🙈 Arc-elmosás + 🎯 objektum-követő elmosás. Önálló szekció — saját
 * busy-állapotok és handlerek; a vászon-pipettát a `setPickTarget`-en keresztül
 * használja, a klip faceBlur-mezőjét a command-buson írja.
 */
export function FaceBlurSection({ clip }: { clip: VideoClip | ImageClip }) {
  const { t } = useTranslation();
  const updateClip = useEditorStore((s) => s.updateClip);
  const setPickTarget = useEditorStore((s) => s.setPickTarget);
  const [faceBusy, setFaceBusy] = useState(false);
  const [blurTrackBusy, setBlurTrackBusy] = useState(false);

  // 🙈 arc-elmosás: több kockán megkeresi az arcokat, és a befoglaló régiót
  // (a fejmozgást is lefedve) elmossa a renderben
  const toggleFaceBlur = async () => {
    if (faceBusy) {
      return;
    }
    if (clip.faceBlur) {
      updateClip(clip.id, { faceBlur: undefined });
      return;
    }
    setFaceBusy(true);
    try {
      const project = useEditorStore.getState().project;
      const ar = project ? aspectValue(project.aspectRatio) : 9 / 16;
      const span = clip.kind === 'video' ? clip.duration * clip.speed : 0;
      const start = clip.kind === 'video' ? clip.trimIn : 0;
      const times =
        clip.kind === 'video'
          ? [0.1, 0.3, 0.5, 0.7, 0.9].map((p) => start + span * p)
          : [0];
      const frames = await Promise.all(
        times.map((t) => fetchFaces(clip.uri, { atSec: t, aspectW: ar, aspectH: 1 }))
      );
      const found = frames.filter((f): f is NonNullable<typeof f> => Boolean(f));
      if (found.length === 0) {
        Alert.alert(t('panels.filter.faceBlurTitle'), t('panels.filter.faceDetectorUnavailable'));
        return;
      }
      const region = faceUnionRegion(found);
      if (!region) {
        Alert.alert(
          t('panels.filter.faceBlurTitle'),
          t('panels.filter.faceNotFound')
        );
        return;
      }
      updateClip(clip.id, { faceBlur: { ...region, strength: 1 } });
    } finally {
      setFaceBusy(false);
    }
  };

  /** 🎯 blur követi az objektumot: a vásznon rákoppintasz, a régió végigköveti (videón) */
  const trackBlur = (point: { x: number; y: number }) => {
    if (clip.kind !== 'video' || blurTrackBusy) {
      return;
    }
    const state = useEditorStore.getState();
    const project = state.project;
    if (!project) {
      return;
    }
    if (state.playhead < clip.start || state.playhead >= clip.start + clip.duration) {
      Alert.alert(t('panels.filter.blurTrackTitle'), t('panels.filter.blurTrackPlayhead'));
      return;
    }
    const endTl = Math.min(clip.start + clip.duration, state.playhead + 15);
    const durTl = endTl - state.playhead;
    if (durTl < 0.5) {
      Alert.alert(t('panels.filter.blurTrackTitle'), t('panels.filter.trackNoSubject'));
      return;
    }
    const startInClip = state.playhead - clip.start;
    setBlurTrackBusy(true);
    trackSubject(clip.uri, {
      startSec: clip.trimIn + startInClip * clip.speed,
      durationSec: durTl * clip.speed,
      cx: point.x,
      cy: point.y,
      aspectW: aspectValue(project.aspectRatio),
      aspectH: 1,
    })
      .then((points) => {
        if (!points) {
          Alert.alert(t('panels.filter.blurTrackTitle'), t('panels.filter.trackNoSubject'));
          return;
        }
        // klip-lokális idő = a szakasz kezdete + forrás-idő/sebesség
        const track = points.map((p) => ({ t: startInClip + p.t / clip.speed, x: p.x, y: p.y }));
        const prev = clip.faceBlur;
        state.updateClip(clip.id, {
          faceBlur: {
            x: point.x,
            y: point.y,
            w: prev?.w ?? 0.25,
            h: prev?.h ?? 0.25,
            strength: prev?.strength ?? 1,
            pixelate: prev?.pixelate,
            track,
          },
        });
        Alert.alert(t('panels.filter.blurTrackDone'), t('panels.filter.blurTrackDoneBody', { count: track.length }));
      })
      .catch((err: Error) => Alert.alert(t('panels.filter.blurTrackTitle'), err.message))
      .finally(() => setBlurTrackBusy(false));
  };
  const startBlurTrackPick = () => {
    Alert.alert(t('panels.filter.blurTrackTitle'), t('panels.filter.blurTrackHint'));
    setPickTarget((point) => trackBlur(point));
  };

  return (
    <PanelSection title={t('panels.filter.sectionFaceBlur')}>
      <View style={styles.row}>
        <Chip
          label={
            faceBusy
              ? t('panels.filter.chipFaceSearching')
              : clip.faceBlur
                ? t('panels.filter.chipFaceBlurOn')
                : t('panels.filter.chipFaceBlur')
          }
          active={Boolean(clip.faceBlur)}
          onPress={() => {
            void toggleFaceBlur();
          }}
        />
        {clip.faceBlur ? (
          <Chip
            label={clip.faceBlur.pixelate ? t('panels.filter.chipMosaic') : t('panels.filter.chipSoft')}
            active={clip.faceBlur.pixelate === true}
            onPress={() =>
              updateClip(clip.id, {
                faceBlur: { ...clip.faceBlur!, pixelate: !clip.faceBlur!.pixelate },
              })
            }
          />
        ) : null}
        {/* 🎯 az elmosás követ egy kijelölt objektumot (videón) */}
        {clip.kind === 'video' ? (
          <Chip
            label={
              blurTrackBusy
                ? t('panels.filter.tracking')
                : clip.faceBlur?.track?.length
                  ? t('panels.filter.blurTrackOn')
                  : t('panels.filter.blurTrack')
            }
            active={Boolean(clip.faceBlur?.track?.length)}
            onPress={startBlurTrackPick}
          />
        ) : null}
      </View>
      {clip.faceBlur ? (
        <Stepper
          label={t('panels.filter.strength')}
          value={`${Math.round((clip.faceBlur.strength ?? 1) * 100)}%`}
          onDec={() =>
            updateClip(clip.id, {
              faceBlur: {
                ...clip.faceBlur!,
                strength: clamp((clip.faceBlur!.strength ?? 1) - 0.2, 0.3, 2),
              },
            })
          }
          onInc={() =>
            updateClip(clip.id, {
              faceBlur: {
                ...clip.faceBlur!,
                strength: clamp((clip.faceBlur!.strength ?? 1) + 0.2, 0.3, 2),
              },
            })
          }
        />
      ) : null}
      <Text style={styles.note}>
        {t('panels.filter.noteFaceBlur')}
      </Text>
    </PanelSection>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
  },
});
