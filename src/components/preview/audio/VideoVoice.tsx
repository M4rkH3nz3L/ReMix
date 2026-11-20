import { useAudioPlayer } from 'expo-audio';
import { useEffect, useMemo, useRef, useState } from 'react';

import { resolveClipUri } from '@/lib/assetResolve';
import { INITIAL_DRIFT, planDriftCorrection, sourceTimeOf, type DriftState } from '@/lib/avSync';
import { sampleChannel } from '@/lib/keyframes';
import { logCaught } from '@/lib/logCaught';
import { clamp } from '@/lib/time';
import { ensureVoiceProxy, getVoiceProxySync, needsVoiceProxy } from '@/lib/voiceProxy';
import { useEditorStore } from '@/store/editorStore';
import type { VideoClip } from '@/types/project';

import { useSystemInterruptGuard } from './useSystemInterruptGuard';

/**
 * 🎙️ A VIDEÓKLIP javított hangja az előnézetben.
 *
 * A videó saját hangsávját a lejátszó szólaltatja meg — feldolgozni nem tudja.
 * Ezért a javított hangot külön lejátszóval, ugyanarra a rAF-órára szinkronban
 * játsszuk, a videó saját hangját pedig elnémítjuk (a `PreviewSurface` a
 * `videoVoiceActive` jelzőt figyeli).
 *
 * SZÁNDÉKOS KORLÁT: csak 1× sebességnél fut. Gyorsított/lassított klipnél a
 * feldolgozott hang átütemezése külön tempó-korrekciót kívánna, és egy
 * elcsúszott, visszhangos duplázás rosszabb lenne, mint a nyers hang — ezért
 * ott a videó saját hangja marad.
 */
export function VideoVoice() {
  const project = useEditorStore((s) => s.project);
  const playhead = useEditorStore((s) => s.playhead);
  // gyors vissza és előre alatt a hang néma: a lejátszók csak 1×-en szólnak helyesen
  const isPlaying = useEditorStore((s) => s.isPlaying && s.playbackRate === 1);
  const setVideoVoiceActive = useEditorStore((s) => s.setVideoVoiceActive);
  const masterVolume = useEditorStore((s) => s.masterVolume);

  const track = project ? project.tracks.find((t) => t.type === 'video') : null;
  const clip = track
    ? (track.clips.find(
        (c) =>
          c.kind === 'video' &&
          c.start <= playhead &&
          c.start + c.duration > playhead
      ) as VideoClip | undefined)
    : undefined;

  // 🔗 ADR-012: a feloldott (asseten át) forrás-uri; memoizált (nem per-frame)
  const resolvedUri = useMemo(
    () => (project && clip ? (resolveClipUri(project, clip) ?? clip.uri) : null),
    [project, clip]
  );
  const eligible = Boolean(
    clip &&
      clip.speed === 1 &&
      clip.volume > 0 &&
      needsVoiceProxy({ voiceEnhance: clip.voiceEnhance, deReverb: clip.deReverb })
  );
  const opts = clip ? { voiceEnhance: clip.voiceEnhance, deReverb: clip.deReverb } : null;
  const key = clip && eligible
    ? `${resolvedUri ?? clip.uri}|${clip.voiceEnhance ? 'e' : ''}${clip.deReverb ? 'd' : ''}`
    : '';
  const [fetched, setFetched] = useState<{ key: string; uri: string | null } | null>(null);

  // A dep-lista CSAK primitíveket tartalmaz (a `clip`/`opts` objektum minden
  // renderben új referencia lenne), így őszinte lehet — nem kell elnémítani a
  // hook-szabályt, és a React Compiler nem hagyja ki emiatt a komponenst.
  const srcUri = eligible && clip ? (resolvedUri ?? clip.uri) : null;
  const enhance = clip?.voiceEnhance ?? false;
  const deReverb = clip?.deReverb ?? false;
  useEffect(() => {
    if (!srcUri) {
      return;
    }
    let alive = true;
    ensureVoiceProxy(srcUri, { voiceEnhance: enhance, deReverb }).then((uri) => {
      if (alive) {
        setFetched({ key, uri });
      }
    });
    return () => {
      alive = false;
    };
  }, [srcUri, enhance, deReverb, key]);

  const uri =
    clip && opts && eligible
      ? (getVoiceProxySync(resolvedUri ?? clip.uri, opts) ??
        (fetched?.key === key ? fetched.uri : null))
      : null;

  const player = useAudioPlayer(null);
  useSystemInterruptGuard(player, isPlaying && Boolean(uri), clip ? sourceTimeOf(clip, clip.start + clip.duration) : Infinity, 'videovoice');
  const driftRef = useRef<DriftState>(INITIAL_DRIFT);
  const loadedRef = useRef<string | null>(null);

  // a videó saját hangját csak akkor némítjuk, ha a javított tényleg szól
  useEffect(() => {
    setVideoVoiceActive(Boolean(uri));
    return () => setVideoVoiceActive(false);
  }, [uri, setVideoVoiceActive]);

  useEffect(() => {
    if (!uri) {
      if (loadedRef.current !== null) {
        loadedRef.current = null;
        try {
          player.pause();
        } catch (caught) {
          logCaught('components/preview/AudioLayer.tsx:VideoVoice', caught);
          // a lejátszó már eldobható állapotban lehet
        }
      }
      return;
    }
    if (loadedRef.current === uri) {
      return;
    }
    loadedRef.current = uri;
    try {
      player.replace(uri);
    } catch (caught) {
      logCaught('components/preview/AudioLayer.tsx:VideoVoice', caught);
      // hibás fájl — a videó saját hangja veszi vissza
    }
  }, [player, uri]);

  useEffect(() => {
    if (!uri || !clip) {
      return;
    }
    // a proxy a TELJES forrás hangja, ezért a forrás-időre kell tekerni (egységes seek-pont)
    const sourceTime = sourceTimeOf(clip, playhead);
    try {
      player.volume =
        clamp(
          sampleChannel(clip.keyframes?.volume, playhead - clip.start, clip.volume),
          0,
          1
        ) * masterVolume;
      if (isPlaying) {
        if (!player.playing) {
          player.seekTo(sourceTime).catch((caught) => { logCaught('components/preview/AudioLayer.tsx:VideoVoice', caught); });
          player.play();
        } else {
          // 🎚️ A/V-szinkron: tanuló, 40 ms tűréssel (`planDriftCorrection`)
          const plan = planDriftCorrection(driftRef.current, sourceTime, player.currentTime, Date.now());
          driftRef.current = plan.next;
          if (plan.seekTo !== null) {
            player.seekTo(plan.seekTo).catch((caught) => { logCaught('components/preview/AudioLayer.tsx:VideoVoice', caught); });
          }
        }
      } else {
        player.pause();
        player.seekTo(sourceTime).catch((caught) => { logCaught('components/preview/AudioLayer.tsx:VideoVoice', caught); });
      }
    } catch (caught) {
      logCaught('components/preview/AudioLayer.tsx:VideoVoice', caught);
      // a lejátszó még nem áll készen
    }
  }, [player, uri, clip, playhead, isPlaying, masterVolume]);

  return null;
}
