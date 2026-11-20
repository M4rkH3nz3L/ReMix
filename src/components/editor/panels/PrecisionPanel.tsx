import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppearanceSection } from '@/components/editor/panels/precision/AppearanceSection';
import { CompoundSection } from '@/components/editor/panels/precision/CompoundSection';
import { ImageTrackSection } from '@/components/editor/panels/precision/ImageTrackSection';
import { KeyframesSection } from '@/components/editor/panels/precision/KeyframesSection';
import {
  createCompoundProxyAction,
  createImageTrackActions,
  createTimingActions,
} from '@/components/editor/panels/precision/precisionActions';
import { AlignSection, TimebaseSection, TimingSection } from '@/components/editor/panels/precision/TimingSections';
import { frameDuration, projectFps } from '@/lib/frames';
import { STEP, type ChannelCfg, type StepMode } from '@/lib/precisionPanelOps';
import { useEditorStore } from '@/store/editorStore';
import type { Clip } from '@/types/project';

/** Pro eszköz: kezdet/hossz tizedmásodperces igazítása + lejátszófej-műveletek. */
export function PrecisionPanel({ clip }: { clip: Clip }) {
  // 🧭 A bontás után a gyökér már FORDÍTHATÓ lenne a React Compilerrel (előtte kimaradt: a try/finally
  // a gyökérben volt), de a memoizálás bekapcsolása viselkedés-változás → külön döntés
  // (tools/reactCompiler.test.js KNOWN_BAILS).
  'use no memo';
  const { t } = useTranslation();
  const updateClip = useEditorStore((s) => s.updateClip);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const playhead = useEditorStore((s) => s.playhead);
  const [kfChannel, setKfChannel] = useState<ChannelCfg['id']>('scale');
  const [stepMode, setStepMode] = useState<StepMode>('sec');
  const [trackBusy, setTrackBusy] = useState(false);
  const [proxyBusy, setProxyBusy] = useState(false);
  const setPickTarget = useEditorStore((s) => s.setPickTarget);
  const fps = useEditorStore((s) => projectFps(s.project));
  const dispatch = useEditorStore((s) => s.dispatch);

  const renderCompoundProxy = createCompoundProxyAction({ clip, t, proxyBusy, setProxyBusy, updateClip });
  const step = stepMode === 'frame' ? frameDuration(fps) : STEP;
  const { startTrackPick } = createImageTrackActions({ clip, t, trackBusy, setTrackBusy, setPickTarget });
  const { setStart, setDuration, nudgePlayhead, alignToPlayhead } = createTimingActions({
    clip,
    updateClip,
    setPlayhead,
    playhead,
    stepMode,
    fps,
    step,
  });

  return (
    <View>
      {/* 🎞️ Timebase: a projekt frame-rátája (egész app erre a rácsra ül) */}
      <TimebaseSection fps={fps} dispatch={dispatch} />

      <TimingSection
        clip={clip}
        fps={fps}
        stepMode={stepMode}
        setStepMode={setStepMode}
        step={step}
        setStart={setStart}
        setDuration={setDuration}
      />

      <AlignSection
        clip={clip}
        stepMode={stepMode}
        nudgePlayhead={nudgePlayhead}
        alignToPlayhead={alignToPlayhead}
        setPlayhead={setPlayhead}
      />

      {clip.kind === 'video' || clip.kind === 'image' ? (
        <KeyframesSection
          clip={clip}
          kfChannel={kfChannel}
          setKfChannel={setKfChannel}
          playhead={playhead}
          updateClip={updateClip}
          setPlayhead={setPlayhead}
        />
      ) : null}

      {clip.kind === 'video' || clip.kind === 'image' ? (
        <AppearanceSection clip={clip} updateClip={updateClip} />
      ) : null}

      {/* 🎯 Objektum-követés: a kép/matrica a videó egy kijelölt objektumát követi */}
      {clip.kind === 'image' ? (
        <ImageTrackSection clip={clip} updateClip={updateClip} trackBusy={trackBusy} startTrackPick={startTrackPick} />
      ) : null}

      {/* 🧱 Compound clip: a beágyazott kompozíció valós előnézete (proxy render) */}
      {clip.kind === 'video' && clip.comp ? (
        <CompoundSection comp={clip.comp} proxyBusy={proxyBusy} renderCompoundProxy={renderCompoundProxy} />
      ) : null}
    </View>
  );
}
