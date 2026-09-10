import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Chip, PanelSection, Stepper } from '@/components/ui/controls';
import { EDIT_FPS, FRAME, MIN_CLIP_DURATION, palette } from '@/constants/editor';
import {
  KF_EPS,
  keyframeTimes,
  removeKeyframesAt,
  sampleClipTransform,
  setChannelKeyframe,
} from '@/lib/keyframes';
import { maxVideoDuration } from '@/lib/projectUtils';
import { clamp, formatTime } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { Clip, KeyframeEasing } from '@/types/project';

const STEP = 0.1;

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

const EASINGS: { id: KeyframeEasing; label: string }[] = [
  { id: 'easeInOut', label: 'Lágy' },
  { id: 'linear', label: 'Lineáris' },
  { id: 'easeIn', label: 'Felpörgő' },
  { id: 'easeOut', label: 'Lassuló' },
];

/** Pro eszköz: kezdet/hossz tizedmásodperces igazítása + lejátszófej-műveletek. */
export function PrecisionPanel({ clip }: { clip: Clip }) {
  const updateClip = useEditorStore((s) => s.updateClip);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const playhead = useEditorStore((s) => s.playhead);
  const [easing, setEasing] = useState<KeyframeEasing>('easeInOut');
  const [stepMode, setStepMode] = useState<StepMode>('sec');
  const step = stepMode === 'frame' ? FRAME : STEP;

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
      <PanelSection title="Időzítés">
        <View style={styles.row}>
          <Chip
            label="0,1 mp"
            active={stepMode === 'sec'}
            onPress={() => setStepMode('sec')}
          />
          <Chip
            label={`1 képkocka (${EDIT_FPS} fps)`}
            active={stepMode === 'frame'}
            onPress={() => setStepMode('frame')}
          />
        </View>
        <Stepper
          label="Kezdet"
          value={formatTime(clip.start)}
          onDec={() => setStart(clip.start - step)}
          onInc={() => setStart(clip.start + step)}
        />
        <Stepper
          label="Hossz"
          value={formatTime(clip.duration)}
          onDec={() => setDuration(clip.duration - step)}
          onInc={() => setDuration(clip.duration + step)}
        />
        <Text style={styles.range}>
          {formatTime(clip.start)} → {formatTime(clip.start + clip.duration)}
          {stepMode === 'frame'
            ? `  ·  ${Math.round(clip.start * EDIT_FPS)}. kocka, ${Math.round(
                clip.duration * EDIT_FPS
              )} kocka hosszú`
            : ''}
        </Text>
      </PanelSection>

      <PanelSection title="Igazítás">
        <View style={styles.row}>
          <Chip
            label={stepMode === 'frame' ? '◀ 1 kocka' : '◀ 0,1 mp'}
            active={false}
            onPress={() => nudgePlayhead(-1)}
          />
          <Chip
            label={stepMode === 'frame' ? '1 kocka ▶' : '0,1 mp ▶'}
            active={false}
            onPress={() => nudgePlayhead(1)}
          />
          <Chip label="Kezdet a lejátszófejhez" active={false} onPress={alignToPlayhead} />
          <Chip
            label="Lejátszófej a klip elejére"
            active={false}
            onPress={() => setPlayhead(clip.start)}
          />
          <Chip
            label="Lejátszófej a klip végére"
            active={false}
            onPress={() => setPlayhead(clip.start + clip.duration)}
          />
        </View>
      </PanelSection>

      {clip.kind === 'video' || clip.kind === 'image' ? (
        <PanelSection title="Kulcskockák — zoom/pan">
          {(() => {
            const tInClip = clamp(playhead - clip.start, 0, clip.duration);
            const times = keyframeTimes(clip.keyframes);
            const onKeyframe = times.some((t) => Math.abs(t - tInClip) <= KF_EPS);
            const addAtPlayhead = () => {
              const current = sampleClipTransform(clip, tInClip);
              const k = clip.keyframes ?? {};
              updateClip(clip.id, {
                keyframes: {
                  scale: setChannelKeyframe(k.scale, tInClip, current.scale, easing),
                  x: setChannelKeyframe(k.x, tInClip, current.x, easing),
                  y: setChannelKeyframe(k.y, tInClip, current.y, easing),
                },
              });
            };
            return (
              <>
                <View style={styles.row}>
                  <Chip
                    label={onKeyframe ? '◆ Kulcskocka frissítése' : '◆ Kulcskocka itt'}
                    active={onKeyframe}
                    onPress={addAtPlayhead}
                  />
                  {onKeyframe ? (
                    <Chip
                      label="✕ Törlés itt"
                      active={false}
                      onPress={() =>
                        updateClip(clip.id, {
                          keyframes: removeKeyframesAt(clip.keyframes, tInClip),
                        })
                      }
                    />
                  ) : null}
                  {times.length > 0 ? (
                    <Chip
                      label="Összes törlése"
                      active={false}
                      onPress={() => updateClip(clip.id, { keyframes: undefined })}
                    />
                  ) : null}
                </View>
                <View style={styles.row}>
                  {EASINGS.map((e) => (
                    <Chip
                      key={e.id}
                      label={e.label}
                      active={easing === e.id}
                      onPress={() => setEasing(e.id)}
                    />
                  ))}
                </View>
                {times.length > 0 ? (
                  <View style={styles.row}>
                    {times.map((t) => (
                      <Chip
                        key={t.toFixed(2)}
                        label={`◆ ${formatTime(clip.start + t)}`}
                        active={Math.abs(t - tInClip) <= KF_EPS}
                        onPress={() => setPlayhead(clip.start + t)}
                      />
                    ))}
                  </View>
                ) : null}
                <Text style={styles.range}>
                  Állítsd be a zoomot/pozíciót a vásznon, majd „◆ Kulcskocka itt” — a
                  klip a kulcskockák közt animálva mozog (az easing az új kulcskockára
                  vonatkozik). Kulcskockás klipen a csippentés/húzás is kulcskockát ír.
                </Text>
              </>
            );
          })()}
        </PanelSection>
      ) : null}

      {clip.kind === 'video' || clip.kind === 'image' ? (
        <PanelSection title="Megjelenés">
          <Stepper
            label="Forgatás"
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
            label="Átlátszóság"
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
