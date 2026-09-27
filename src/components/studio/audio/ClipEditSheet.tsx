import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyframeGraphEditor } from '@/components/editor/KeyframeGraphEditor';
import { RegionBar, Slider, ToggleRow, useWaveform } from '@/components/studio/audio/primitives';
import { palette } from '@/constants/editor';
import type { EditorCommand } from '@/lib/commands';
import { snapToFrame } from '@/lib/frames';
import { makeId } from '@/lib/id';
import { separateStems } from '@/lib/stems';
import { clamp } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import { guardPro } from '@/store/paywallStore';
import { withProgress } from '@/store/progressStore';
import type { AudioClip, AudioFx, Project, TrackType } from '@/types/project';

/**
 * 🎚️ Klip-szerkesztő lap — a kijelölt hangklip nem-destruktív szerkesztése
 * (trim / fade / hangerő / pan / enhance / Pro FX). Minden a `HangStudio`-ból
 * ismert mintát követi: a lap LOKÁLIS állapotban dolgozik, és a „Kész" EGY
 * `updateClip`-pel commitál → EGY undo-lépés. A vágás/keyframe frame-rácsra ül.
 */
export function ClipEditSheet({
  clip,
  fps,
  onClose,
}: {
  clip: AudioClip;
  fps: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const updateClip = useEditorStore((s) => s.updateClip);
  const applyBatch = useEditorStore((s) => s.applyBatch);
  const playhead = useEditorStore((s) => s.playhead);
  const [separating, setSeparating] = useState(false);

  // 🎚️ AI stem-szeparáció (Pro): a klip hangját vocals/drums/bass/other klipekre
  // bontja (voiceover/sfx sávra), és az eredetit elnémítja — EGY undo.
  const onSeparate = () =>
    guardPro(
      () =>
        withProgress(t('studio.audio.stemsWorking'), () => {
          setSeparating(true);
          return separateStems(clip.uri).then((stems) => {
            if (stems.length === 0) {
              return;
            }
            const commands: EditorCommand[] = stems.map((s) => {
              const track: TrackType = s.name === 'vocals' ? 'voiceover' : 'sfx';
              const stemClip: AudioClip = {
                id: makeId('clip'),
                kind: 'audio',
                start: clip.start,
                duration: clip.duration,
                trimIn: 0,
                sourceDuration: clip.duration,
                uri: s.url,
                label: s.name,
                volume: 1,
                fadeIn: 0,
                fadeOut: 0,
                source: track === 'voiceover' ? 'voiceover' : 'imported',
              };
              return { type: 'ADD_CLIP', trackType: track, clip: stemClip };
            });
            commands.push({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { volume: 0 } });
            applyBatch(commands, 'user');
            onClose();
          });
        }),
      (e) => Alert.alert(t('studio.audio.stems'), e.message)
    ).finally(() => setSeparating(false));

  const [volume, setVolume] = useState(clip.volume);
  const [fadeIn, setFadeIn] = useState(clip.fadeIn);
  const [fadeOut, setFadeOut] = useState(clip.fadeOut);
  const [duration, setDuration] = useState(clip.duration);
  const [trimIn, setTrimIn] = useState(clip.trimIn ?? 0);
  const [pan, setPan] = useState(clip.pan ?? 0);
  const [voiceEnhance, setVoiceEnhance] = useState(!!clip.voiceEnhance);
  const [deReverb, setDeReverb] = useState(!!clip.deReverb);
  const [autoDuck, setAutoDuck] = useState(!!clip.autoDuck);
  const [fx, setFx] = useState<AudioFx>(clip.audioFx ?? {});

  const wave = useWaveform(clip.uri);
  const sourceDuration = clip.sourceDuration ?? clip.duration; // a trim ENNYIN belül mozoghat
  const maxFade = Math.min(5, duration / 2);
  const clipPlayhead = playhead - clip.start;

  const patchFx = (p: Partial<AudioFx>) => setFx((prev) => ({ ...prev, ...p }));

  const dirty =
    volume !== clip.volume ||
    fadeIn !== clip.fadeIn ||
    fadeOut !== clip.fadeOut ||
    duration !== clip.duration ||
    trimIn !== (clip.trimIn ?? 0) ||
    pan !== (clip.pan ?? 0) ||
    voiceEnhance !== !!clip.voiceEnhance ||
    deReverb !== !!clip.deReverb ||
    autoDuck !== !!clip.autoDuck ||
    JSON.stringify(fx) !== JSON.stringify(clip.audioFx ?? {});

  const onDone = () => {
    if (dirty) {
      const snapped = snapToFrame(duration, fps);
      updateClip(clip.id, {
        volume,
        pan,
        fadeIn: Math.min(fadeIn, snapped),
        fadeOut: Math.min(fadeOut, snapped),
        duration: Math.max(snapToFrame(0.1, fps), snapped),
        trimIn: snapToFrame(trimIn, fps),
        sourceDuration,
        voiceEnhance,
        deReverb,
        autoDuck,
        audioFx: fx,
      } as Partial<AudioClip>);
    }
    onClose();
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.wrap}>
        <Pressable style={styles.tap} onPress={onClose} />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title} numberOfLines={1}>
              {clip.label || t('hangStudio.title')}
            </Text>
            <Pressable onPress={onDone} style={styles.doneBtn}>
              <Ionicons name="checkmark" size={18} color="#fff" />
              <Text style={styles.doneText}>{t('common.done')}</Text>
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }}>
            <RegionBar
              trimIn={trimIn}
              duration={duration}
              sourceDuration={sourceDuration}
              fadeIn={fadeIn}
              fadeOut={fadeOut}
              playhead={clipPlayhead}
              peaks={wave?.peaks ?? null}
              waveDuration={wave?.duration ?? sourceDuration}
              onChange={({ trimIn: ti, duration: d }) => {
                setTrimIn(ti);
                setDuration(d);
                setFadeIn((v) => Math.min(v, d / 2));
                setFadeOut((v) => Math.min(v, d / 2));
              }}
            />

            <Slider
              label={t('hangStudio.volume')}
              value={volume}
              min={0}
              max={1}
              onChange={setVolume}
              format={(v) => `${Math.round(v * 100)}%`}
            />
            <Slider
              label={t('studio.audio.pan')}
              value={pan}
              min={-1}
              max={1}
              onChange={setPan}
              format={(v) =>
                v === 0 ? t('studio.audio.panCenter') : `${v < 0 ? 'L' : 'R'} ${Math.round(Math.abs(v) * 100)}`
              }
            />
            <Slider
              label={t('hangStudio.fadeIn')}
              value={fadeIn}
              min={0}
              max={maxFade}
              onChange={setFadeIn}
              format={(v) => `${v.toFixed(1)}s`}
            />
            <Slider
              label={t('hangStudio.fadeOut')}
              value={fadeOut}
              min={0}
              max={maxFade}
              onChange={setFadeOut}
              format={(v) => `${v.toFixed(1)}s`}
            />

            {/* 🎚️ hangerő-automáció (value/time görbe) — élő, mint az AudioPanelben */}
            <Text style={styles.autoLabel}>{t('panels.audio.volumeAutomation')}</Text>
            <KeyframeGraphEditor
              keyframes={clip.keyframes?.volume ?? []}
              duration={clip.duration}
              min={0}
              max={1}
              fallback={clip.volume}
              playhead={clamp(playhead - clip.start, 0, clip.duration)}
              onChange={(next) =>
                updateClip(clip.id, {
                  keyframes: { ...clip.keyframes, volume: next.length > 0 ? next : undefined },
                })
              }
              onSeek={(tt) => useEditorStore.getState().setPlayhead(clip.start + tt)}
              formatValue={(v) => `${Math.round(v * 100)}%`}
            />

            <View style={styles.divider} />
            <ToggleRow icon="sparkles-outline" label={t('hangStudio.enhance')} value={voiceEnhance} onValueChange={setVoiceEnhance} />
            <ToggleRow icon="mic-outline" label={t('hangStudio.deReverb')} value={deReverb} onValueChange={setDeReverb} />
            <ToggleRow icon="volume-low-outline" label={t('hangStudio.autoDuck')} value={autoDuck} onValueChange={setAutoDuck} />

            <View style={styles.divider} />
            <View style={styles.fxHead}>
              <Ionicons name="pulse-outline" size={15} color={palette.accent} />
              <Text style={styles.fxTitle}>{t('panels.audio.fxTitle')}</Text>
              <View style={styles.proTag}>
                <Text style={styles.proTagText}>PRO</Text>
              </View>
            </View>
            <ToggleRow icon="remove-circle-outline" label={t('panels.audio.fxDenoise')} value={!!fx.denoise} onValueChange={(v) => patchFx({ denoise: v })} />
            <ToggleRow icon="cut-outline" label={t('panels.audio.fxDeEsser')} value={!!fx.deEsser} onValueChange={(v) => patchFx({ deEsser: v })} />
            <ToggleRow icon="contract-outline" label={t('panels.audio.fxCompressor')} value={!!fx.compressor} onValueChange={(v) => patchFx({ compressor: v })} />
            <ToggleRow icon="alert-outline" label={t('panels.audio.fxLimiter')} value={!!fx.limiter} onValueChange={(v) => patchFx({ limiter: v })} />
            <ToggleRow icon="options-outline" label={t('panels.audio.fxNormalize')} value={!!fx.normalize} onValueChange={(v) => patchFx({ normalize: v })} />
            <Slider
              label={t('panels.audio.fxReverb')}
              value={fx.reverb ?? 0}
              min={0}
              max={1}
              onChange={(v) => patchFx({ reverb: v })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
            <Text style={styles.hint}>{t('panels.audio.mixHint')}</Text>

            {/* 🎚️ AI stem-szeparáció (Pro) */}
            <View style={styles.divider} />
            <Pressable onPress={onSeparate} disabled={separating} style={styles.stemsBtn}>
              <Ionicons
                name={separating ? 'hourglass-outline' : 'git-branch-outline'}
                size={16}
                color={palette.accent}
              />
              <Text style={styles.stemsText}>{t('studio.audio.stems')}</Text>
              <View style={styles.proTag}>
                <Text style={styles.proTagText}>PRO</Text>
              </View>
            </Pressable>
            <Text style={styles.hint}>{t('studio.audio.stemsHint')}</Text>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

/** kényelmi: a store-projektből a kijelölt hangklip (vagy null). */
export function selectedAudioClip(project: Project | null, selectedClipId: string | null): AudioClip | null {
  if (!project || !selectedClipId) {
    return null;
  }
  for (const track of project.tracks) {
    const found = track.clips.find((c) => c.id === selectedClipId);
    if (found && found.kind === 'audio') {
      return found;
    }
  }
  return null;
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0009' },
  tap: { flex: 1 },
  sheet: {
    backgroundColor: '#0b0d14',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 14,
    maxHeight: '82%',
    borderTopWidth: 1,
    borderColor: palette.border,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  title: { flex: 1, color: palette.text, fontSize: 16, fontWeight: '800' },
  doneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: palette.accent,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  doneText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  divider: { height: 1, backgroundColor: palette.border, marginVertical: 12 },
  fxHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  fxTitle: { flex: 1, color: palette.text, fontSize: 13, fontWeight: '800' },
  proTag: { backgroundColor: palette.accentSoft, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  proTagText: { color: palette.accent, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  hint: { color: palette.textDim, fontSize: 11, lineHeight: 16, marginTop: 10 },
  autoLabel: { color: palette.textDim, fontSize: 12, fontWeight: '600', marginTop: 12, marginBottom: 4 },
  stemsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceHigh,
  },
  stemsText: { flex: 1, color: palette.text, fontSize: 14, fontWeight: '700' },
});
