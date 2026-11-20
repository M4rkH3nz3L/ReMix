import { useAudioPlayer } from 'expo-audio';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { resolveClipUri } from '@/lib/assetResolve';
import { clipPreviewVolume } from '@/lib/audioLayerMix';
import { probeDrift, probeSeek, probeStart, syncProbeOn } from '@/lib/audioSyncProbe';
import { audioSpeedOf, needsStretchProxy } from '@/lib/audioTrim';
import { INITIAL_DRIFT, learnStartLatency, planDriftCorrection, sourceTimeOf, type DriftState } from '@/lib/avSync';
import { logCaught } from '@/lib/logCaught';
import { ensureStretchProxy, getStretchProxySync, stretchProxyKey } from '@/lib/stretchProxy';
import { ensureVoiceProxy, getVoiceProxySync, needsVoiceProxy } from '@/lib/voiceProxy';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip } from '@/types/project';

import { useSystemInterruptGuard } from './useSystemInterruptGuard';

/** ⏱️ a tanult indítási késés (mp) — közös a lejátszóknak (`learnStartLatency`) */
// a hangnál 0-ról tanul: a 0,15-ös kezdőérték mérve időnként utólagos igazítást okozott
let startLatencySec = 0;

/**
 * Egyetlen audio-klip lejátszója (saját `useAudioPlayer`), a rAF-órához szinkronban.
 * A `TrackAudio` klipenként egy példányt rendertel → a sávon belüli ÁTFEDÉST ez
 * teszi lehetővé (a párhuzamos klipek akusztikusan összegződnek). A klip inaktívvá
 * válásakor a komponens unmountol → a lejátszó elhallgat + felszabadul.
 */
export function ClipAudioPlayer({
  clip: editClip,
  audible: audibleProp,
  trackGain,
}: {
  clip: AudioClip;
  audible: boolean;
  trackGain: number;
}) {
  const project = useEditorStore((s) => s.project);
  const playhead = useEditorStore((s) => s.playhead);
  // gyors vissza és előre alatt a hang néma: a lejátszók csak 1×-en szólnak helyesen
  const clockRunning = useEditorStore((s) => s.isPlaying && s.playbackRate === 1);
  const masterVolume = useEditorStore((s) => s.masterVolume);
  // ⏱️ preroll alatt a klip még nem szól: betöltve vár a forrás elején
  const sounding = playhead >= editClip.start;
  const isPlaying = clockRunning && sounding;

  // 🔗 ADR-012: a feloldott (asseten át) forrás-uri; memoizált (nem per-frame)
  const resolvedUri = useMemo(
    () => (project ? (resolveClipUri(project, editClip) ?? editClip.uri) : null),
    [project, editClip]
  );

  const player = useAudioPlayer(null);
  const loadedUriRef = useRef<string | null>(null);

  /**
   * 🎙️ Voice Studio előnézet: ha a klipen be van kapcsolva az Enhance/de-reverb,
   * a FELDOLGOZOTT hangot játsszuk (ugyanaz a lánc, mint a renderben). Amíg a
   * proxy készül, a nyers hang szól — így a lejátszás sosem akad meg. A kész
   * proxyt RENDER-IDŐBEN olvassuk a cache-ből (nincs setState az effektben).
   */
  const voiceOpts = { voiceEnhance: editClip.voiceEnhance, deReverb: editClip.deReverb };
  const needsProxy = needsVoiceProxy(voiceOpts);
  const voiceKey = `${resolvedUri ?? editClip.uri}|${editClip.voiceEnhance ? 'e' : ''}${editClip.deReverb ? 'd' : ''}`;
  const [fetched, setFetched] = useState<{ key: string; uri: string | null } | null>(null);

  // csak primitív függőségek → őszinte dep-lista, elnémított hook-szabály nélkül
  const voiceSrcUri = needsProxy ? (resolvedUri ?? editClip.uri) : null;
  const voiceEnhance = editClip.voiceEnhance ?? false;
  const voiceDeReverb = editClip.deReverb ?? false;
  useEffect(() => {
    if (!voiceSrcUri) {
      return;
    }
    let alive = true;
    ensureVoiceProxy(voiceSrcUri, {
      voiceEnhance: voiceEnhance,
      deReverb: voiceDeReverb,
    }).then((uri) => {
      if (alive) {
        setFetched({ key: voiceKey, uri });
      }
    });
    return () => {
      alive = false;
    };
  }, [voiceSrcUri, voiceEnhance, voiceDeReverb, voiceKey]);

  const voiceUri = needsProxy
    ? (getVoiceProxySync(resolvedUri ?? editClip.uri, voiceOpts) ??
      (fetched?.key === voiceKey ? fetched.uri : null))
    : null;
  // ⏩⏪ visszafelé vagy 0,5–2×-en kívül: az előre elkészített szakasz szól 1×-en (amíg készül, csend)
  const stretchNeeded = needsStretchProxy(editClip);
  const stretchSrc = resolvedUri ?? editClip.uri;
  const stretchKey = stretchNeeded ? stretchProxyKey(stretchSrc, editClip) : null;
  const [stretched, setStretched] = useState<{ key: string; uri: string | null } | null>(null);
  const stretchTrimIn = editClip.trimIn;
  const stretchDuration = editClip.duration;
  const stretchSpeed = editClip.speed;
  const stretchReversed = editClip.reversed;
  useEffect(() => {
    if (!stretchKey) {
      return;
    }
    let alive = true;
    void ensureStretchProxy(stretchSrc, { trimIn: stretchTrimIn, duration: stretchDuration, speed: stretchSpeed, reversed: stretchReversed }).then((uri) => {
      if (alive) {
        setStretched({ key: stretchKey, uri });
      }
    });
    return () => {
      alive = false;
    };
  }, [stretchKey, stretchSrc, stretchTrimIn, stretchDuration, stretchSpeed, stretchReversed]);
  const stretchUri = stretchKey ? (getStretchProxySync(stretchKey) ?? (stretched?.key === stretchKey ? stretched.uri : null)) : null;
  // a lejátszás szemszögéből a klip: a kész szakasz a klip elejétől, 1×-en, előre
  const clip = useMemo(
    () => (stretchUri ? { ...editClip, uri: stretchUri, trimIn: 0, speed: undefined, reversed: undefined } : editClip),
    [editClip, stretchUri]
  );
  useSystemInterruptGuard(player, isPlaying, sourceTimeOf(clip, clip.start + clip.duration), clip.id);
  const playUri = stretchNeeded ? stretchUri : (voiceUri ?? resolvedUri ?? clip.uri ?? null);
  // amíg az új szakasz készül (pl. vágás után), a régi nem szólhat rossz időzítéssel
  const audible = audibleProp && (!stretchNeeded || stretchUri !== null);

  // betöltés + kezdő seek/play (forrás-idő = trimIn + klip-eleji offset, avSync)
  useEffect(() => {
    if (!playUri || loadedUriRef.current === playUri) {
      return;
    }
    loadedUriRef.current = playUri;
    try {
      player.replace(playUri);
      // ⏩ gyorsított hangklip: hangmagasság-tartással (a render atempo-jának megfelelője)
      if (audioSpeedOf(clip) !== 1) {
        player.shouldCorrectPitch = true;
        player.setPlaybackRate(audioSpeedOf(clip), 'high');
      }
      const state = useEditorStore.getState();
      player.seekTo(Math.max(clip.trimIn ?? 0, sourceTimeOf(clip, state.playhead))).catch((caught) => { logCaught('components/preview/AudioLayer.tsx:ClipAudioPlayer', caught); });
      if (state.isPlaying && state.playhead >= clip.start) {
        player.play();
      }
    } catch (caught) { logCaught('components/preview/AudioLayer.tsx:ClipAudioPlayer', caught); }
  }, [player, clip, playUri]);

  // play/pause követés; indításkor a tanult indítási késéssel előrébb indul
  const playStartRef = useRef(0);
  useEffect(() => {
    try {
      if (isPlaying) {
        if (audioSpeedOf(clip) !== 1) {
          player.setPlaybackRate(audioSpeedOf(clip), 'high');
        }
        if (startLatencySec > 0) {
          const st = useEditorStore.getState();
          // a késés idővonal-idő; a gyorsított klip forrása ennyiszer gyorsabban halad
          player.seekTo(sourceTimeOf(clip, st.playhead) + startLatencySec * audioSpeedOf(clip)).catch((caught) => { logCaught('components/preview/AudioLayer.tsx:ClipAudioPlayer', caught); });
        }
        playStartRef.current = Date.now();
        latencyLearnedRef.current = false;
        player.play();
      } else {
        player.pause();
      }
    } catch (caught) { logCaught('components/preview/AudioLayer.tsx:ClipAudioPlayer', caught); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a klip-adat (trimIn/start) a store-ból jön; az indítás csak play/pause váltásra fut
  }, [player, isPlaying]);

  // a klip inaktívvá válásakor elhallgat; layout-effekt, mert a hook sima effektje addigra
  // felszabadítja a lejátszót
  useLayoutEffect(
    () => () => {
      try {
        player.pause();
      } catch (caught) { logCaught('components/preview/AudioLayer.tsx:ClipAudioPlayer', caught); }
    },
    [player]
  );

  // álló óránál seek, futásnál hangerő + fade követés.
  // ⚡ A playhead ~60×/mp változik — csak érdemi hangerő-eltérésnél írunk (sima fade).
  const lastVolRef = useRef<number | null>(null);
  const driftRef = useRef<DriftState>(INITIAL_DRIFT);
  const prerolledRef = useRef<string | null>(null);
  const latencyLearnedRef = useRef(false);
  useEffect(() => {
    const t = playhead - clip.start;
    try {
      // 🎚️ hangerő-automáció: a volume-csatorna a playheadből interpolál (× fade × fader × master)
      const vol = clipPreviewVolume(clip, t, audible, trackGain, masterVolume);
      if (lastVolRef.current === null || Math.abs(vol - lastVolRef.current) > 0.005) {
        player.volume = vol;
        lastVolRef.current = vol;
      }
      if (!sounding) {
        // preroll: egyszer a forrás elejére, és ott vár (nem tekergetünk minden képkockán)
        if (prerolledRef.current !== playUri) {
          prerolledRef.current = playUri;
          player.seekTo(clip.trimIn ?? 0).catch((caught) => { logCaught('components/preview/AudioLayer.tsx:ClipAudioPlayer', caught); });
        }
        return;
      }
      prerolledRef.current = null;
      const sourceTime = sourceTimeOf(clip, playhead);
      if (syncProbeOn() && isPlaying && player.playing) {
        probeStart(clip.id, sourceTime - player.currentTime);
        probeDrift(clip.id, sourceTime, player.currentTime, playhead - clip.start);
      }
      if (!isPlaying) {
        // álló óránál a forrás-időre tekerünk (egységes seek-pont)
        player.seekTo(sourceTime).catch((caught) => { logCaught('components/preview/AudioLayer.tsx:ClipAudioPlayer', caught); });
      } else if (player.playing) {
        const now = Date.now();
        const sinceStart = now - playStartRef.current;
        // ⏩ a gyorsított klip eltérése idővonal-időben számít (a hallható csúszás): a forrás-idő
        // `speed`-del halad, ezért minden összevetés és a tanult késés is el van osztva vele
        const speed = audioSpeedOf(clip);
        // ⏱️ az indulás után ~0,5 mp-cel mért eltérés = az indítási késés (eszköz-szintű tanulás)
        if (!latencyLearnedRef.current && sinceStart > 400 && sinceStart < 1200) {
          latencyLearnedRef.current = true;
          startLatencySec = learnStartLatency(startLatencySec, startLatencySec + (sourceTime - player.currentTime) / speed);
        }
        // 🎚️ A/V-szinkron lejátszás közben: tanuló, 40 ms tűréssel (`planDriftCorrection`)
        const plan = planDriftCorrection(driftRef.current, sourceTime / speed, player.currentTime / speed, now);
        driftRef.current = plan.next;
        if (plan.seekTo !== null) {
          probeSeek();
          player.seekTo(plan.seekTo * speed).catch((caught) => { logCaught('components/preview/AudioLayer.tsx:ClipAudioPlayer', caught); });
        }
      }
    } catch (caught) { logCaught('components/preview/AudioLayer.tsx:ClipAudioPlayer', caught); }
  }, [player, playhead, isPlaying, sounding, playUri, clip, audible, masterVolume, trackGain]);

  return null;
}
