import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * 🎵 ZENE belépési pont (PRO-MUSIC-STUDIO K1 · AUDIO-PROD S10): külön Music Stúdió nincs és nem is
 * kell — a `music` fajtájú projekt UGYANAZT a Hang Stúdiót nyitja, a Zene munkaterületre állítva
 * (hangszerek elöl: piano roll, dobgép, sampler, tempó). A projekt-modell azonos az `audio`-éval.
 */
export default function MusicStudioRedirect() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={`/studio/audio/${id}?ws=music`} />;
}
