import { useAudioPlayer } from 'expo-audio';
import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { shouldResync, sourceTimeOf } from '@/lib/avSync';
import { sampleChannel } from '@/lib/keyframes';
import { clipsAt } from '@/lib/projectUtils';
import { clamp } from '@/lib/time';
import { ensureVoiceProxy, getVoiceProxySync, needsVoiceProxy } from '@/lib/voiceProxy';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, TrackType, VideoClip } from '@/types/project';

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
 * Láthatatlan réteg: sávonként egy lejátszó (zene + voiceover + SFX egyszerre
 * szól), a rAF-órához szinkronizálva. Egy sávon belül átfedésnél a legutóbb
 * kezdődő klip szól; a fade-görbék a hangerőn keresztül érvényesülnek.
 *
 * ⚠️ FÓKUSZ-KAPU: a réteget a szerkesztő ÉS a lejátszó képernyő is mountolja, és
 * a navigáció `push`-sal megy (az előző képernyő mountolva marad). Kapu nélkül
 * mindkét példány 4 natív lejátszót tartana életben ugyanarra a `isPlaying`
 * állapotra — duplikált hang és felesleges dekóder-terhelés. Takart képernyőn
 * nem rendereljük, így a lejátszók fel is szabadulnak.
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
  const isPlaying = useEditorStore((s) => s.isPlaying);
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

  const eligible = Boolean(
    clip &&
      clip.speed === 1 &&
      clip.volume > 0 &&
      needsVoiceProxy({ voiceEnhance: clip.voiceEnhance, deReverb: clip.deReverb })
  );
  const opts = clip ? { voiceEnhance: clip.voiceEnhance, deReverb: clip.deReverb } : null;
  const key = clip && eligible
    ? `${clip.uri}|${clip.voiceEnhance ? 'e' : ''}${clip.deReverb ? 'd' : ''}`
    : '';
  const [fetched, setFetched] = useState<{ key: string; uri: string | null } | null>(null);

  // A dep-lista CSAK primitíveket tartalmaz (a `clip`/`opts` objektum minden
  // renderben új referencia lenne), így őszinte lehet — nem kell elnémítani a
  // hook-szabályt, és a React Compiler nem hagyja ki emiatt a komponenst.
  const srcUri = eligible && clip ? clip.uri : null;
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
      ? (getVoiceProxySync(clip.uri, opts) ??
        (fetched?.key === key ? fetched.uri : null))
      : null;

  const player = useAudioPlayer(null);
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
        } catch {
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
    } catch {
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
          player.seekTo(sourceTime).catch(() => {});
          player.play();
        } else if (shouldResync(sourceTime, player.currentTime)) {
          // 🎚️ A/V-drift-korrekció: a natív hang elcsúszott a mestéróra playheadjétől → vissza
          player.seekTo(sourceTime).catch(() => {});
        }
      } else {
        player.pause();
        player.seekTo(sourceTime).catch(() => {});
      }
    } catch {
      // a lejátszó még nem áll készen
    }
  }, [player, uri, clip, playhead, isPlaying, masterVolume]);

  return null;
}

function TrackAudio({ trackType }: { trackType: TrackType }) {
  const project = useEditorStore((s) => s.project);
  const playhead = useEditorStore((s) => s.playhead);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  // 🎚️ sáv-monitorozás: némítás/solo CSAK az előnézetre hat (a render nem tud róla)
  const mutedTracks = useEditorStore((s) => s.mutedTracks);
  const soloTracks = useEditorStore((s) => s.soloTracks);
  const masterVolume = useEditorStore((s) => s.masterVolume);
  const audible =
    soloTracks.length > 0 ? soloTracks.includes(trackType) : !mutedTracks.includes(trackType);

  // 🎚️ sávonkénti mixer-gain (fader) — az előnézetben (a render is honorálja)
  const trackGain = project?.trackMix?.[trackType]?.gain ?? 1;
  const track = project ? project.tracks.find((t) => t.type === trackType) : null;
  const active = track
    ? clipsAt<AudioClip>(track, playhead).filter((c) => c.kind === 'audio')
    : [];
  const clip = active.length > 0 ? active.reduce((a, b) => (b.start >= a.start ? b : a)) : null;

  const player = useAudioPlayer(null);
  const loadedUriRef = useRef<string | null>(null);

  /**
   * 🎙️ Voice Studio előnézet: ha a klipen be van kapcsolva az Enhance/de-reverb,
   * a FELDOLGOZOTT hangot játsszuk (ugyanaz a lánc, mint a renderben). Amíg a
   * proxy készül, a nyers hang szól — így a lejátszás sosem akad meg.
   *
   * A kész proxyt RENDER-IDŐBEN olvassuk a memória-cache-ből (nincs setState az
   * effektben — azt a `react-hooks/set-state-in-effect` szabály tiltja); az
   * effekt csak az aszinkron elkészítést indítja, és a kulccsal együtt tárolja
   * az eredményt, hogy egy elavult válasz ne kerülhessen másik kliphez.
   */
  const voiceOpts = clip
    ? { voiceEnhance: clip.voiceEnhance, deReverb: clip.deReverb }
    : null;
  const needsProxy = voiceOpts ? needsVoiceProxy(voiceOpts) : false;
  const voiceKey = clip
    ? `${clip.uri}|${clip.voiceEnhance ? 'e' : ''}${clip.deReverb ? 'd' : ''}`
    : '';
  const [fetched, setFetched] = useState<{ key: string; uri: string | null } | null>(null);

  // csak primitív függőségek → őszinte dep-lista, elnémított hook-szabály nélkül
  const voiceSrcUri = needsProxy && clip ? clip.uri : null;
  const voiceEnhance = clip?.voiceEnhance ?? false;
  const voiceDeReverb = clip?.deReverb ?? false;
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

  const voiceUri =
    clip && voiceOpts && needsProxy
      ? (getVoiceProxySync(clip.uri, voiceOpts) ??
        (fetched?.key === voiceKey ? fetched.uri : null))
      : null;
  const playUri = voiceUri ?? clip?.uri ?? null;

  useEffect(() => {
    if (!clip) {
      if (loadedUriRef.current !== null) {
        loadedUriRef.current = null;
        try {
          player.pause();
        } catch {}
      }
      return;
    }
    if (!playUri || loadedUriRef.current === playUri) {
      return;
    }
    loadedUriRef.current = playUri;
    try {
      player.replace(playUri);
      const state = useEditorStore.getState();
      // forrás-idő = trimIn + a klip-eleji offset (egységes seek-pont, avSync)
      player.seekTo(sourceTimeOf(clip, state.playhead)).catch(() => {});
      if (state.isPlaying) {
        player.play();
      }
    } catch {}
  }, [player, clip, playUri]);

  useEffect(() => {
    try {
      if (isPlaying && clip) {
        player.play();
      } else {
        player.pause();
      }
    } catch {}
  }, [player, isPlaying, clip]);

  // álló óránál seek, futásnál hangerő + fade követés.
  // ⚡ A playhead ~60×/mp változik, és ebből a rétegből 4 példány fut (zene,
  // voiceover, SFX, videó-hang) — küszöb nélkül ez 240 natív hangerő-írás
  // másodpercenként. Csak érdemi eltérésnél írunk (a fade-görbe így is sima).
  const lastVolRef = useRef<number | null>(null);
  useEffect(() => {
    if (!clip) {
      return;
    }
    const t = playhead - clip.start;
    try {
      // 🎚️ hangerő-automáció: a volume-csatorna a playheadből interpolál
      const automated = sampleChannel(clip.keyframes?.volume, t, clip.volume);
      const vol = (audible ? clamp(automated * fadeFactor(clip, t), 0, 1) : 0) * trackGain * masterVolume;
      if (lastVolRef.current === null || Math.abs(vol - lastVolRef.current) > 0.005) {
        player.volume = vol;
        lastVolRef.current = vol;
      }
      const sourceTime = sourceTimeOf(clip, playhead);
      if (!isPlaying) {
        // álló óránál a forrás-időre tekerünk (egységes seek-pont)
        player.seekTo(sourceTime).catch(() => {});
      } else if (player.playing && shouldResync(sourceTime, player.currentTime)) {
        // 🎚️ A/V-drift-korrekció lejátszás közben (a jank miatti elcsúszás behúzása)
        player.seekTo(sourceTime).catch(() => {});
      }
    } catch {}
  }, [player, playhead, isPlaying, clip, audible, masterVolume, trackGain]);

  return null;
}
