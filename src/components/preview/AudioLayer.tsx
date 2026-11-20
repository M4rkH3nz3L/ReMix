import { useIsFocused } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';

import { previewMixPlan } from '@/lib/audioLayerMix';
import { previewEngine } from '@/lib/previewEngine';
import { useEditorStore } from '@/store/editorStore';
import { fetchPreviewSource, remoteUris, withLocalSources } from '@/lib/previewRemoteCache';
import { useReference } from '@/store/referenceStore';
import { AUDIO_TRACKS } from '@/lib/audioTracks';

import { engineCanPlay } from './audio/enginePlayable';
import { MixEngineLayer } from './audio/MixEngineLayer';
import { TrackAudio } from './audio/TrackAudio';
import { VideoVoice } from './audio/VideoVoice';

// REFACTOR: a részek az audio/ alatt (motor, klip-lejátszók, videóhang, megszakítás-őr), a mag a lib/audioLayerMix.ts
export { withoutProcessing } from '@/lib/audioLayerMix';

/** a hangot hordozó sávok — mindhez saját lejátszó, egyszerre szólnak */

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
  // 🎧🅰️🅱️ referencia hallgatása: a motor a referenciát játssza a keverés helyett (hangosság-illesztve)
  const refTrack = useReference((s) => (s.listening ? s.ref : null));
  const mixLufs = useReference((s) => s.mixLufs);
  const plan = useMemo(
    () => previewMixPlan(project, { masterVolume, muted, solo, fxBypass, refTrack, mixLufs }),
    [project, masterVolume, muted, solo, fxBypass, refTrack, mixLufs]
  );
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
