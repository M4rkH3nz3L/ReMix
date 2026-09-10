import { useAudioPlayer } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';

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
 */
export function AudioLayer() {
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

  useEffect(() => {
    if (!clip || !opts || !eligible) {
      return;
    }
    let alive = true;
    ensureVoiceProxy(clip.uri, opts).then((uri) => {
      if (alive) {
        setFetched({ key, uri });
      }
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, eligible]);

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
    // a proxy a TELJES forrás hangja, ezért a forrás-időre kell tekerni
    const sourceTime = clip.trimIn + (playhead - clip.start);
    try {
      player.volume = clamp(
        sampleChannel(clip.keyframes?.volume, playhead - clip.start, clip.volume),
        0,
        1
      );
      if (isPlaying) {
        if (!player.playing) {
          player.seekTo(Math.max(0, sourceTime)).catch(() => {});
          player.play();
        }
      } else {
        player.pause();
        player.seekTo(Math.max(0, sourceTime)).catch(() => {});
      }
    } catch {
      // a lejátszó még nem áll készen
    }
  }, [player, uri, clip, playhead, isPlaying]);

  return null;
}

function TrackAudio({ trackType }: { trackType: TrackType }) {
  const project = useEditorStore((s) => s.project);
  const playhead = useEditorStore((s) => s.playhead);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  // 🎚️ sáv-monitorozás: némítás/solo CSAK az előnézetre hat (a render nem tud róla)
  const mutedTracks = useEditorStore((s) => s.mutedTracks);
  const soloTracks = useEditorStore((s) => s.soloTracks);
  const audible =
    soloTracks.length > 0 ? soloTracks.includes(trackType) : !mutedTracks.includes(trackType);

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

  useEffect(() => {
    if (!clip || !voiceOpts || !needsProxy) {
      return;
    }
    let alive = true;
    ensureVoiceProxy(clip.uri, voiceOpts).then((uri) => {
      if (alive) {
        setFetched({ key: voiceKey, uri });
      }
    });
    return () => {
      alive = false;
    };
    // a voiceKey fedi a uri-t és mindkét kapcsolót
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceKey, needsProxy]);

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
      player.seekTo(Math.max(0, state.playhead - clip.start)).catch(() => {});
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

  // álló óránál seek, futásnál hangerő + fade követés
  useEffect(() => {
    if (!clip) {
      return;
    }
    const t = playhead - clip.start;
    try {
      // 🎚️ hangerő-automáció: a volume-csatorna a playheadből interpolál
      const automated = sampleChannel(clip.keyframes?.volume, t, clip.volume);
      player.volume = audible ? clamp(automated * fadeFactor(clip, t), 0, 1) : 0;
      if (!isPlaying) {
        player.seekTo(Math.max(0, t)).catch(() => {});
      }
    } catch {}
  }, [player, playhead, isPlaying, clip, audible]);

  return null;
}
