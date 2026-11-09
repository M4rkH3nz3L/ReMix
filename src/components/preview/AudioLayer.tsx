import { useAudioPlayer, type AudioPlayer } from 'expo-audio';
import { useIsFocused } from 'expo-router';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { resolveClipUri } from '@/lib/assetResolve';
import { clipsForPlayback, INITIAL_DRIFT, learnStartLatency, planDriftCorrection, sourceTimeOf, type DriftState } from '@/lib/avSync';
import { probeDrift, probeSeek, probeStart, syncProbeOn } from '@/lib/audioSyncProbe';
import { mixForExport } from '@/lib/audioExportMix';
import { registerDevAction } from '@/lib/devActions';
import { canSegment, isLongSource } from '@/lib/longSource';
import { needsWholeWindow, offlineMixPlan, type OfflineMixPlan } from '@/lib/offlineMix';
import { previewEngine } from '@/lib/previewEngine';
import { ensureStretchProxy, getStretchProxySync, stretchProxyKey } from '@/lib/stretchProxy';
import { detectSystemPause, INITIAL_STALL } from '@/lib/interruption';
import { audioSpeedOf, needsStretchProxy } from '@/lib/audioTrim';
import { sampleChannel } from '@/lib/keyframes';

import { clamp } from '@/lib/time';
import { ensureVoiceProxy, getVoiceProxySync, needsVoiceProxy } from '@/lib/voiceProxy';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, Clip, Project, TrackType, VideoClip } from '@/types/project';
import { logCaught } from '@/lib/logCaught';
import { fetchPreviewSource, remoteUris, withLocalSources } from '@/lib/previewRemoteCache';
import { AUDIO_TRACKS } from '@/lib/audioTracks';

/** ⏱️ a tanult indítási késés (mp) — közös a lejátszóknak (`learnStartLatency`) */
// a hangnál 0-ról tanul: a 0,15-ös kezdőérték mérve időnként utólagos igazítást okozott
let startLatencySec = 0;

/** a hangot hordozó sávok — mindhez saját lejátszó, egyszerre szólnak */

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
  const project = useEditorStore((s) => s.project);
  const masterVolume = useEditorStore((s) => s.masterVolume);
  const muted = useEditorStore((s) => s.mutedTracks);
  const solo = useEditorStore((s) => s.soloTracks);
  const fxBypass = useEditorStore((s) => s.fxBypass);
  // 🎧 az exporttal AZONOS keverési terv (mute/solo/fader/master is) — ezt játssza a motor;
  // 🅰️🅱️ A/B-nél a feldolgozás nélküli eredeti (az exportot nem érinti)
  const plan = useMemo(() => {
    if (!project) {
      return null;
    }
    const audible = (t: TrackType) => (solo.length > 0 ? solo.includes(t) : !muted.includes(t));
    const mix = mixForExport(fxBypass ? withoutProcessing(project) : project, audible, masterVolume);
    return mix ? offlineMixPlan(mix) : null;
  }, [project, masterVolume, muted, solo, fxBypass]);
  // 🌐 a távoli forrású klipek: letöltés a cache-be, utána a motor játssza (a +dB, effekt, master is)
  const remote = useMemo(() => remoteUris(plan), [plan]);
  const [localOf, setLocalOf] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    for (const u of remote) {
      void fetchPreviewSource(u).then((l) => {
        if (alive && l) setLocalOf((m) => (m[u] === l ? m : { ...m, [u]: l }));
      });
    }
    return () => {
      alive = false;
    };
  }, [remote]);
  const enginePlan = useMemo(() => withLocalSources(plan, localOf), [plan, localOf]);
  const [engineOk, setEngineOk] = useState(false);
  useEffect(() => {
    let alive = true;
    void previewEngine.available().then((ok) => {
      if (alive) setEngineOk(ok);
    });
    return () => {
      alive = false;
    };
  }, []);
  if (!isFocused) {
    return null;
  }
  if (engineOk && !previewEngine.forceFallback && engineCanPlay(enginePlan)) {
    return <MixEngineLayer plan={enginePlan} />;
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

/** 🅰️🅱️ a projekt feldolgozás nélkül: klip-effektek, hangjavítás, visszhang-csökkentés, master nélkül */
export function withoutProcessing(project: Project): Project {
  return {
    ...project,
    audioMaster: undefined,
    tracks: project.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) =>
        c.kind === 'audio'
          ? ({ ...c, audioFx: undefined, voiceEnhance: false, deReverb: false } as Clip)
          : c.kind === 'video'
            ? ({ ...c, voiceEnhance: false, deReverb: false } as Clip)
            : c
      ),
    })),
  };
}

/**
 * 🎧 A motor játszhatja-e a projektet: amit a közös keverő (= az export) tud, helyi forrásokból;
 * a hosszú forrás szakaszosan (`longSource`). Különben a klipenkénti lejátszók szólnak.
 */
function engineCanPlay(plan: OfflineMixPlan | null): boolean {
  return !plan || (plan.unsupported.length === 0 && plan.clips.every((c) => c.uri.startsWith('file:') && longClipPlayable(c)));
}

/**
 * 🎧 a hosszú (10 percnél hosszabb) forrás szakaszosan szól — ha a build tud szakaszosan
 * dekódolni, és a klip nem kér egész-ablakos feldolgozást (azt a telefon hosszú forráson nem
 * bírná: a 60 perces zajszűrés ~27 perc volna)
 */
function longClipPlayable(c: OfflineMixPlan['clips'][number]): boolean {
  if (!isLongSource(c.sourceDuration)) {
    return true;
  }
  return canSegment() && !needsWholeWindow(c);
}

/**
 * 🎧 „Azt kapod, amit hallasz”: az előre renderelt előnézet (`previewEngine`) bekötése. A terv
 * változására (szerkesztés, mute/solo, fader) a még el nem indult szeletek újrakeverődnek; a
 * lejátszófej a hangórából jön (`usePlaybackClock`); a videók saját hangja néma, mert azt is a
 * motor keveri (`videoVoiceActive`).
 */
function MixEngineLayer({ plan }: { plan: OfflineMixPlan | null }) {
  const isPlaying = useEditorStore((s) => s.isPlaying && s.playbackRate === 1);
  const setVideoVoiceActive = useEditorStore((s) => s.setVideoVoiceActive);

  useEffect(() => {
    previewEngine.arm(true);
    setVideoVoiceActive(true);
    // 📞 hívás / Siri: a felfüggesztett motorral a transzport is megáll (nem fut tovább némán)
    previewEngine.onInterrupted = () => useEditorStore.getState().setPlaying(false);
    return () => {
      previewEngine.onInterrupted = null;
      previewEngine.arm(false);
      setVideoVoiceActive(false);
    };
  }, [setVideoVoiceActive]);

  useEffect(() => {
    void previewEngine.setPlan(plan).catch((caught) => { logCaught('components/preview/AudioLayer.tsx:MixEngineLayer', caught); });
  }, [plan]);

  useEffect(() => {
    if (isPlaying) {
      void previewEngine.play(useEditorStore.getState().playhead).catch((caught) => { logCaught('components/preview/AudioLayer.tsx:MixEngineLayer', caught); });
    } else {
      previewEngine.pause();
    }
  }, [isPlaying]);

  // ugrás lejátszás közben (scrub, hurok, kattintás a vonalzón): a motor onnan folytatja
  useEffect(
    () =>
      useEditorStore.subscribe((st, prev) => {
        if (st.playhead !== prev.playhead && previewEngine.isPlaying() && Math.abs(st.playhead - previewEngine.position()) > 0.15) {
          previewEngine.seek(st.playhead);
        }
      }),
    []
  );
  return null;
}

/** 📞 a megszakítás-figyelés ütemezése (a rendszer-szünet küszöbe 700 ms, `interruption.ts`) */
const INTERRUPT_POLL_MS = 150;

/**
 * 📞 PRO-AUDIO 17/18: hívás, Siri, fülhallgató-kihúzás — a rendszer natívan megállítja a
 * lejátszót, a JS nem kap eseményt. Futó óránál az elnémult lejátszó megállítja a transzportot
 * (különben a lejátszófej néma hangra fut tovább); álló óránál a magától újraindult lejátszót
 * (az iOS a hívás végén folytatja) leállítjuk. `sourceEnd`: a klip forrás-vége (ott a leállás
 * természetes).
 */
function useSystemInterruptGuard(player: AudioPlayer, isPlaying: boolean, sourceEnd: number, devId: string) {
  const playingRef = useRef(isPlaying);
  const endRef = useRef(sourceEnd);
  useEffect(() => {
    playingRef.current = isPlaying;
    endRef.current = sourceEnd;
  }, [isPlaying, sourceEnd]);

  useEffect(() => {
    let stall = INITIAL_STALL;
    const timer = setInterval(() => {
      try {
        if (!playingRef.current) {
          stall = INITIAL_STALL;
          if (player.playing) {
            player.pause();
          }
          return;
        }
        const time = player.currentTime;
        const end = Math.min(endRef.current, player.duration > 0 ? player.duration : Infinity);
        const r = detectSystemPause(stall, { playing: player.playing, buffering: player.isBuffering, time, nowMs: Date.now(), nearEnd: time >= end - 0.25 });
        stall = r.next;
        if (r.stopped && useEditorStore.getState().isPlaying) {
          stall = INITIAL_STALL;
          useEditorStore.getState().setPlaying(false);
        }
      } catch (caught) {
        logCaught('components/preview/AudioLayer.tsx:useSystemInterruptGuard', caught);
      }
    }, INTERRUPT_POLL_MS);
    // 🧪 füstteszt: ugyanaz a natív pause/play, amit az iOS megszakításkor hív
    const offPause = registerDevAction(`audio.nativePause.${devId}`, () => player.pause());
    const offPlay = registerDevAction(`audio.nativePlay.${devId}`, () => player.play());
    const offState = registerDevAction(`audio.nativePlaying.${devId}`, () => player.playing);
    const offRate = registerDevAction(`audio.nativeRate.${devId}`, () => player.playbackRate);
    return () => {
      clearInterval(timer);
      offPause();
      offPlay();
      offState();
      offRate();
    };
  }, [player, devId]);
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
