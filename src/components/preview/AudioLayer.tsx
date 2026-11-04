import { useAudioPlayer } from 'expo-audio';
import { useIsFocused } from 'expo-router';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { resolveClipUri } from '@/lib/assetResolve';
import { clipsForPlayback, INITIAL_DRIFT, learnStartLatency, planDriftCorrection, sourceTimeOf, type DriftState } from '@/lib/avSync';
import { probeDrift, probeSeek, probeStart, syncProbeOn } from '@/lib/audioSyncProbe';
import { sampleChannel } from '@/lib/keyframes';

import { clamp } from '@/lib/time';
import { ensureVoiceProxy, getVoiceProxySync, needsVoiceProxy } from '@/lib/voiceProxy';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, TrackType, VideoClip } from '@/types/project';
import { logCaught } from '@/lib/logCaught';

/** ⏱️ a tanult indítási késés (mp) — közös a lejátszóknak (`learnStartLatency`) */
let startLatencySec = 0;

/** a hangot hordozó sávok — mindhez saját lejátszó, egyszerre szólnak */
const AUDIO_TRACKS: TrackType[] = ['music', 'voiceover', 'sfx'];

function fadeFactor(clip: AudioClip, t: number): number {
  let factor = 1;
  if (clip.fadeIn > 0) {
    factor = Math.min(factor, clamp(t / clip.fadeIn, 0, 1));
  }
  if (clip.fadeOut > 0) {
    factor = Math.min(factor, clamp((clip.duration - t) / clip.fadeOut, 0, 1));
  }
  return factor;
}

/**
 * Láthatatlan réteg: sávonként (zene + voiceover + SFX) a playheadnél futó MINDEN
 * klip szól — egy sávon belüli ÁTFEDÉSNÉL is (klipenként saját lejátszó →
 * akusztikusan keverednek), a rAF-órához szinkronban. A fade-görbék a hangerőn át.
 *
 * ⚠️ FÓKUSZ-KAPU: a réteget a szerkesztő ÉS a lejátszó képernyő is mountolja, és
 * a navigáció `push`-sal megy (az előző képernyő mountolva marad). Kapu nélkül
 * mindkét példány lejátszókat tartana életben ugyanarra a `isPlaying` állapotra —
 * duplikált hang és felesleges dekóder-terhelés. Takart képernyőn nem rendereljük,
 * így a lejátszók fel is szabadulnak.
 */
export function AudioLayer() {
  const isFocused = useIsFocused();
  if (!isFocused) {
    return null;
  }
  return (
    <>
      {AUDIO_TRACKS.map((type) => (
        <TrackAudio key={type} trackType={type} />
      ))}
      <VideoVoice />
    </>
  );
}

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
function VideoVoice() {
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

/**
 * Egy audio-sáv: a playheadnél futó MINDEN aktív klipre egy-egy `ClipAudioPlayer`
 * (kulcs = clip.id) → a sávon belüli átfedő klipek EGYSZERRE szólnak (keverednek).
 * Korábban átfedésnél csak a legutóbb kezdődő klip szólt (a többi néma volt).
 */
function TrackAudio({ trackType }: { trackType: TrackType }) {
  const project = useEditorStore((s) => s.project);
  const playhead = useEditorStore((s) => s.playhead);
  // 🎚️ sáv-monitorozás: az audio-export ugyanezt követi (`mixForExport`)
  const mutedTracks = useEditorStore((s) => s.mutedTracks);
  const soloTracks = useEditorStore((s) => s.soloTracks);
  const audible =
    soloTracks.length > 0 ? soloTracks.includes(trackType) : !mutedTracks.includes(trackType);

  // 🎚️ sávonkénti mixer-gain (fader) — az előnézetben (a render is honorálja)
  const trackGain = project?.trackMix?.[trackType]?.gain ?? 1;
  const track = project ? project.tracks.find((t) => t.type === trackType) : null;
  // ⏱️ a hamarosan kezdődő klip lejátszója is elkészül (preroll — betöltve, a forrás elején)
  const active = track
    ? clipsForPlayback(track.clips.filter((c): c is AudioClip => c.kind === 'audio'), playhead)
    : [];

  return (
    <>
      {active.map((clip) => (
        <ClipAudioPlayer key={clip.id} clip={clip} audible={audible} trackGain={trackGain} />
      ))}
    </>
  );
}

/**
 * Egyetlen audio-klip lejátszója (saját `useAudioPlayer`), a rAF-órához szinkronban.
 * A `TrackAudio` klipenként egy példányt rendertel → a sávon belüli ÁTFEDÉST ez
 * teszi lehetővé (a párhuzamos klipek akusztikusan összegződnek). A klip inaktívvá
 * válásakor a komponens unmountol → a lejátszó elhallgat + felszabadul.
 */
function ClipAudioPlayer({
  clip,
  audible,
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
  const sounding = playhead >= clip.start;
  const isPlaying = clockRunning && sounding;

  // 🔗 ADR-012: a feloldott (asseten át) forrás-uri; memoizált (nem per-frame)
  const resolvedUri = useMemo(
    () => (project ? (resolveClipUri(project, clip) ?? clip.uri) : null),
    [project, clip]
  );

  const player = useAudioPlayer(null);
  const loadedUriRef = useRef<string | null>(null);

  /**
   * 🎙️ Voice Studio előnézet: ha a klipen be van kapcsolva az Enhance/de-reverb,
   * a FELDOLGOZOTT hangot játsszuk (ugyanaz a lánc, mint a renderben). Amíg a
   * proxy készül, a nyers hang szól — így a lejátszás sosem akad meg. A kész
   * proxyt RENDER-IDŐBEN olvassuk a cache-ből (nincs setState az effektben).
   */
  const voiceOpts = { voiceEnhance: clip.voiceEnhance, deReverb: clip.deReverb };
  const needsProxy = needsVoiceProxy(voiceOpts);
  const voiceKey = `${resolvedUri ?? clip.uri}|${clip.voiceEnhance ? 'e' : ''}${clip.deReverb ? 'd' : ''}`;
  const [fetched, setFetched] = useState<{ key: string; uri: string | null } | null>(null);

  // csak primitív függőségek → őszinte dep-lista, elnémított hook-szabály nélkül
  const voiceSrcUri = needsProxy ? (resolvedUri ?? clip.uri) : null;
  const voiceEnhance = clip.voiceEnhance ?? false;
  const voiceDeReverb = clip.deReverb ?? false;
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
    ? (getVoiceProxySync(resolvedUri ?? clip.uri, voiceOpts) ??
      (fetched?.key === voiceKey ? fetched.uri : null))
    : null;
  const playUri = voiceUri ?? resolvedUri ?? clip.uri ?? null;

  // betöltés + kezdő seek/play (forrás-idő = trimIn + klip-eleji offset, avSync)
  useEffect(() => {
    if (!playUri || loadedUriRef.current === playUri) {
      return;
    }
    loadedUriRef.current = playUri;
    try {
      player.replace(playUri);
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
        if (startLatencySec > 0) {
          const st = useEditorStore.getState();
          player.seekTo(sourceTimeOf(clip, st.playhead) + startLatencySec).catch((caught) => { logCaught('components/preview/AudioLayer.tsx:ClipAudioPlayer', caught); });
        }
        playStartRef.current = Date.now();
        latencyLearnedRef.current = false;
        player.play();
      } else {
        player.pause();
      }
    } catch (caught) { logCaught('components/preview/AudioLayer.tsx:ClipAudioPlayer', caught); }
    // a klip-adat (trimIn/start) a store-ból jön; az indítás csak a play/pause váltásra fut
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      // 🎚️ hangerő-automáció: a volume-csatorna a playheadből interpolál
      const automated = sampleChannel(clip.keyframes?.volume, t, clip.volume);
      const vol = (audible ? clamp(automated * fadeFactor(clip, t), 0, 1) : 0) * trackGain * masterVolume;
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
        // ⏱️ az indulás után ~0,5 mp-cel mért eltérés = az indítási késés (eszköz-szintű tanulás)
        if (!latencyLearnedRef.current && sinceStart > 400 && sinceStart < 1200) {
          latencyLearnedRef.current = true;
          startLatencySec = learnStartLatency(startLatencySec, startLatencySec + (sourceTime - player.currentTime));
        }
        // 🎚️ A/V-szinkron lejátszás közben: tanuló, 40 ms tűréssel (`planDriftCorrection`)
        const plan = planDriftCorrection(driftRef.current, sourceTime, player.currentTime, now);
        driftRef.current = plan.next;
        if (plan.seekTo !== null) {
          probeSeek();
          player.seekTo(plan.seekTo).catch((caught) => { logCaught('components/preview/AudioLayer.tsx:ClipAudioPlayer', caught); });
        }
      }
    } catch (caught) { logCaught('components/preview/AudioLayer.tsx:ClipAudioPlayer', caught); }
  }, [player, playhead, isPlaying, sounding, playUri, clip, audible, masterVolume, trackGain]);

  return null;
}
