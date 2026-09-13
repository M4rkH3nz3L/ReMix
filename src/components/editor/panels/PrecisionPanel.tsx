import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { KeyframeGraphEditor } from '@/components/editor/KeyframeGraphEditor';
import { Chip, PanelSection, Stepper } from '@/components/ui/controls';
import { aspectValue, EDIT_FPS, FRAME, MIN_CLIP_DURATION, palette } from '@/constants/editor';
import type { KeyframeChannel } from '@/lib/keyframes';
import { activeVisualClip, maxVideoDuration, sourceTimeAt } from '@/lib/projectUtils';
import { isRenderCancelledError, renderMp4 } from '@/lib/render';
import { clamp, formatTime } from '@/lib/time';
import { pointsToPanKeyframes, trackSubject } from '@/lib/track';
import { useEditorStore } from '@/store/editorStore';
import type { Clip, ImageClip, VideoClip } from '@/types/project';

const STEP = 0.1;

/**
 * 🎞️ A Graph Editorban szerkeszthető transzform-csatornák (videó/kép): érték-
 * tartomány + a kulcskocka nélküli szél-érték + megjelenítés.
 */
type ChannelCfg = {
  id: Extract<KeyframeChannel, 'scale' | 'x' | 'y' | 'rotation' | 'opacity'>;
  label: string;
  min: number;
  max: number;
  fallback: (clip: VideoClip | ImageClip) => number;
  fmt: (v: number) => string;
};
const TRANSFORM_CHANNELS: ChannelCfg[] = [
  { id: 'scale', label: 'panels.precision.chScale', min: 0.2, max: 4, fallback: (c) => c.transform?.scale ?? 1, fmt: (v) => `${v.toFixed(2)}×` },
  { id: 'x', label: 'panels.precision.chX', min: -0.75, max: 0.75, fallback: (c) => c.transform?.x ?? 0, fmt: (v) => `${Math.round(v * 100)}%` },
  { id: 'y', label: 'panels.precision.chY', min: -0.75, max: 0.75, fallback: (c) => c.transform?.y ?? 0, fmt: (v) => `${Math.round(v * 100)}%` },
  { id: 'rotation', label: 'panels.precision.chRotation', min: -180, max: 180, fallback: (c) => c.transform?.rotation ?? 0, fmt: (v) => `${Math.round(v)}°` },
  { id: 'opacity', label: 'panels.precision.chOpacity', min: 0, max: 1, fallback: (c) => c.opacity ?? 1, fmt: (v) => `${Math.round(v * 100)}%` },
];

/**
 * A léptetés finomsága. Kockára állítva az érték a render KÉPKOCKA-RÁCSÁRA
 * kerekedik (nem tizedmásodpercre) — SFX-, felirat- és vágás-igazításnál ez
 * kell, mert fél kocka csúszás már látszik/hallatszik.
 */
type StepMode = 'sec' | 'frame';

/** kerekítés a lépés-mód szerint */
function snap(value: number, mode: StepMode): number {
  return mode === 'frame'
    ? Math.round(value * EDIT_FPS) / EDIT_FPS
    : Math.round(value * 100) / 100;
}

/** Pro eszköz: kezdet/hossz tizedmásodperces igazítása + lejátszófej-műveletek. */
export function PrecisionPanel({ clip }: { clip: Clip }) {
  const { t } = useTranslation();
  const updateClip = useEditorStore((s) => s.updateClip);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const playhead = useEditorStore((s) => s.playhead);
  const [kfChannel, setKfChannel] = useState<ChannelCfg['id']>('scale');
  const [stepMode, setStepMode] = useState<StepMode>('sec');
  const [trackBusy, setTrackBusy] = useState(false);
  const [proxyBusy, setProxyBusy] = useState(false);
  const setPickTarget = useEditorStore((s) => s.setPickTarget);

  /**
   * 🧱 Compound előnézet: a beágyazott kompozíciót MP4-proxyba rendereli
   * (local-first, ingyen; összetettnél felhő = Pro), és a klip uri-ját a proxyra
   * cseréli — így a compound a VALÓS tartalmát mutatja (a durva placeholder helyett).
   * Az export úgyis rekurzívan újrarendereli a comp-ot, ez csak az előnézeté.
   */
  const renderCompoundProxy = async () => {
    if (clip.kind !== 'video' || !clip.comp || proxyBusy) {
      return;
    }
    setProxyBusy(true);
    try {
      const comp = clip.comp;
      const sub = {
        id: `${clip.id}-comp`,
        name: 'comp',
        aspectRatio: comp.aspectRatio,
        tracks: comp.tracks,
        assets: comp.assets,
        createdAt: '',
        updatedAt: '',
        schemaVersion: 4,
      };
      const file = await renderMp4(sub, undefined, { resolution: 720, fps: 30, quality: 'medium', codec: 'h264' }, { mode: 'auto' });
      updateClip(clip.id, { uri: file.uri });
      Alert.alert(t('panels.precision.compoundDoneTitle'), t('panels.precision.compoundDoneBody'));
    } catch (err) {
      if (!isRenderCancelledError(err)) {
        Alert.alert(t('panels.precision.compoundTitle'), (err as Error).message);
      }
    } finally {
      setProxyBusy(false);
    }
  };
  const step = stepMode === 'frame' ? FRAME : STEP;

  /**
   * 🎯 Objektum-követés: a felhasználó a vásznon rákoppint a követendő objektumra,
   * a worker (NCC-tracker) végigköveti a videón, és a KÉP a pásztázással utána
   * mozog (a kép a videó fölötti overlay/PiP; a videót követi). Pro (objectTrack).
   */
  const runTrackImage = (point: { x: number; y: number }) => {
    const state = useEditorStore.getState();
    const project = state.project;
    if (!project || trackBusy || clip.kind !== 'image') {
      return;
    }
    const video = activeVisualClip(project, state.playhead);
    if (!video || video.kind !== 'video') {
      Alert.alert(t('panels.precision.trackTitle'), t('panels.precision.trackNeedVideo'));
      return;
    }
    if (state.playhead < clip.start || state.playhead >= clip.start + clip.duration) {
      Alert.alert(t('panels.precision.trackTitle'), t('panels.precision.trackPlayheadOnClip'));
      return;
    }
    const endTl = Math.min(clip.start + clip.duration, video.start + video.duration, state.playhead + 15);
    const durTl = endTl - state.playhead;
    if (durTl < 0.5) {
      Alert.alert(t('panels.precision.trackTitle'), t('panels.precision.trackTooShort'));
      return;
    }
    const base = { x: clip.transform?.x ?? 0, y: clip.transform?.y ?? 0 };
    setTrackBusy(true);
    trackSubject(video.uri, {
      startSec: sourceTimeAt(video, state.playhead),
      durationSec: durTl * video.speed,
      cx: point.x,
      cy: point.y,
      aspectW: aspectValue(project.aspectRatio),
      aspectH: 1,
    })
      .then((points) => {
        if (!points) {
          Alert.alert(t('panels.precision.trackTitle'), t('panels.precision.trackFailed'));
          return;
        }
        const kf = pointsToPanKeyframes(points, base, state.playhead - clip.start, 1 / video.speed);
        state.updateClip(clip.id, { keyframes: { ...clip.keyframes, ...kf } });
        Alert.alert(t('panels.precision.trackDone'), t('panels.precision.trackDoneBody', { count: kf.x.length }));
      })
      .catch((err: Error) => Alert.alert(t('panels.precision.trackTitle'), err.message))
      .finally(() => setTrackBusy(false));
  };
  const startTrackPick = () => {
    Alert.alert(t('panels.precision.trackTitle'), t('panels.precision.trackPickHint'));
    setPickTarget((point) => runTrackImage(point));
  };

  const maxDuration =
    clip.kind === 'video' ? maxVideoDuration(clip) : Number.POSITIVE_INFINITY;

  const setStart = (start: number) => {
    updateClip(clip.id, { start: Math.max(0, snap(start, stepMode)) });
  };

  const setDuration = (duration: number) => {
    updateClip(clip.id, {
      duration: snap(clamp(duration, MIN_CLIP_DURATION, maxDuration), stepMode),
    });
  };

  /** a lejátszófej léptetése ugyanazzal a finomsággal */
  const nudgePlayhead = (dir: 1 | -1) => {
    setPlayhead(snap(playhead + dir * step, stepMode));
  };

  const alignToPlayhead = () => {
    const { playhead } = useEditorStore.getState();
    setStart(playhead);
  };

  return (
    <View>
      <PanelSection title={t('panels.precision.timingTitle')}>
        <View style={styles.row}>
          <Chip
            label={t('panels.precision.stepSec')}
            active={stepMode === 'sec'}
            onPress={() => setStepMode('sec')}
          />
          <Chip
            label={t('panels.precision.stepFrame', { fps: EDIT_FPS })}
            active={stepMode === 'frame'}
            onPress={() => setStepMode('frame')}
          />
        </View>
        <Stepper
          label={t('panels.precision.start')}
          value={formatTime(clip.start)}
          onDec={() => setStart(clip.start - step)}
          onInc={() => setStart(clip.start + step)}
        />
        <Stepper
          label={t('panels.precision.length')}
          value={formatTime(clip.duration)}
          onDec={() => setDuration(clip.duration - step)}
          onInc={() => setDuration(clip.duration + step)}
        />
        <Text style={styles.range}>
          {formatTime(clip.start)} → {formatTime(clip.start + clip.duration)}
          {stepMode === 'frame'
            ? t('panels.precision.frameInfo', {
                startFrame: Math.round(clip.start * EDIT_FPS),
                frameCount: Math.round(clip.duration * EDIT_FPS),
              })
            : ''}
        </Text>
      </PanelSection>

      <PanelSection title={t('panels.precision.alignTitle')}>
        <View style={styles.row}>
          <Chip
            label={
              stepMode === 'frame'
                ? t('panels.precision.nudgeBackFrame')
                : t('panels.precision.nudgeBackSec')
            }
            active={false}
            onPress={() => nudgePlayhead(-1)}
          />
          <Chip
            label={
              stepMode === 'frame'
                ? t('panels.precision.nudgeFwdFrame')
                : t('panels.precision.nudgeFwdSec')
            }
            active={false}
            onPress={() => nudgePlayhead(1)}
          />
          <Chip label={t('panels.precision.startToPlayhead')} active={false} onPress={alignToPlayhead} />
          <Chip
            label={t('panels.precision.playheadToClipStart')}
            active={false}
            onPress={() => setPlayhead(clip.start)}
          />
          <Chip
            label={t('panels.precision.playheadToClipEnd')}
            active={false}
            onPress={() => setPlayhead(clip.start + clip.duration)}
          />
        </View>
      </PanelSection>

      {clip.kind === 'video' || clip.kind === 'image' ? (
        <PanelSection title={t('panels.precision.keyframesTitle')}>
          <View style={styles.row}>
            {TRANSFORM_CHANNELS.map((c) => (
              <Chip
                key={c.id}
                label={t(c.label)}
                active={kfChannel === c.id}
                onPress={() => setKfChannel(c.id)}
              />
            ))}
          </View>
          {(() => {
            const cfg = TRANSFORM_CHANNELS.find((c) => c.id === kfChannel) ?? TRANSFORM_CHANNELS[0];
            const media = clip as VideoClip | ImageClip;
            return (
              <KeyframeGraphEditor
                keyframes={media.keyframes?.[cfg.id] ?? []}
                duration={clip.duration}
                min={cfg.min}
                max={cfg.max}
                fallback={cfg.fallback(media)}
                playhead={clamp(playhead - clip.start, 0, clip.duration)}
                onChange={(next) =>
                  updateClip(clip.id, {
                    keyframes: { ...media.keyframes, [cfg.id]: next.length > 0 ? next : undefined },
                  })
                }
                onSeek={(tt) => setPlayhead(clip.start + tt)}
                formatValue={cfg.fmt}
              />
            );
          })()}
          <Text style={styles.range}>{t('panels.precision.keyframeHint')}</Text>
        </PanelSection>
      ) : null}

      {clip.kind === 'video' || clip.kind === 'image' ? (
        <PanelSection title={t('panels.precision.appearanceTitle')}>
          <Stepper
            label={t('panels.precision.rotation')}
            value={`${clip.transform?.rotation ?? 0}°`}
            onDec={() =>
              updateClip(clip.id, {
                transform: {
                  ...(clip.transform ?? { scale: 1, x: 0, y: 0 }),
                  rotation: ((clip.transform?.rotation ?? 0) - 5 + 360) % 360,
                },
              })
            }
            onInc={() =>
              updateClip(clip.id, {
                transform: {
                  ...(clip.transform ?? { scale: 1, x: 0, y: 0 }),
                  rotation: ((clip.transform?.rotation ?? 0) + 5) % 360,
                },
              })
            }
          />
          <Stepper
            label={t('panels.precision.opacity')}
            value={`${Math.round((clip.opacity ?? 1) * 100)}%`}
            onDec={() =>
              updateClip(clip.id, { opacity: clamp((clip.opacity ?? 1) - 0.1, 0.1, 1) })
            }
            onInc={() =>
              updateClip(clip.id, { opacity: clamp((clip.opacity ?? 1) + 0.1, 0.1, 1) })
            }
          />
        </PanelSection>
      ) : null}

      {/* 🎯 Objektum-követés: a kép/matrica a videó egy kijelölt objektumát követi */}
      {clip.kind === 'image' ? (
        <PanelSection title={t('panels.precision.trackSectionTitle')}>
          <View style={styles.row}>
            <Chip
              label={trackBusy ? t('panels.precision.tracking') : t('panels.precision.trackObject')}
              active={trackBusy}
              onPress={startTrackPick}
            />
            {clip.keyframes?.x?.length ? (
              <Chip
                label={t('panels.precision.trackClear')}
                active={false}
                onPress={() => updateClip(clip.id, { keyframes: undefined })}
              />
            ) : null}
          </View>
          <Text style={styles.range}>{t('panels.precision.trackNote')}</Text>
        </PanelSection>
      ) : null}

      {/* 🧱 Compound clip: a beágyazott kompozíció valós előnézete (proxy render) */}
      {clip.kind === 'video' && clip.comp ? (
        <PanelSection title={t('panels.precision.compoundTitle')}>
          <Text style={styles.range}>
            {t('panels.precision.compoundInfo', { tracks: clip.comp.tracks.length })}
          </Text>
          <View style={styles.row}>
            <Chip
              label={proxyBusy ? t('panels.precision.compoundRendering') : t('panels.precision.compoundRender')}
              active={proxyBusy}
              onPress={() => {
                renderCompoundProxy().catch(() => {});
              }}
            />
          </View>
          <Text style={styles.range}>{t('panels.precision.compoundNote')}</Text>
        </PanelSection>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  range: {
    color: palette.textDim,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
});
