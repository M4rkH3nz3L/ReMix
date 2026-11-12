import { masterPreset } from '@/lib/audioMaster';
import type { AudioMasterTarget, Marker, Project } from '@/types/project';

/**
 * 🧩 Hang-projekt indító-sablonok (AP7) — pure. A létrehozáskor a projektre kerülnek (még nincs
 * history, ezért nem parancs): sáv-nevek, master-cél (hangosság), tempó/ütemjelzés és szerkezeti
 * jelölők. Utána minden a szokásos módon (parancs-buszon) szerkeszthető.
 */
export type AudioTemplate = 'blank' | 'podcast' | 'music' | 'voiceover';
export const AUDIO_TEMPLATES: AudioTemplate[] = ['blank', 'podcast', 'music', 'voiceover'];

/** a sablon alap master-célja (a létrehozó űrlap ehhez állítja a választót) */
export function templateTarget(tpl: AudioTemplate): AudioMasterTarget | null {
  return tpl === 'podcast' ? 'podcast' : tpl === 'music' ? 'music' : tpl === 'voiceover' ? 'video' : null;
}

/** a sablon alkalmazása egy frissen létrehozott hang-projektre (a feliratok a hívó nyelvén) */
export function applyAudioTemplate(
  project: Project,
  tpl: AudioTemplate,
  names: { voice: string; music: string; sfx: string; sections: [string, string, string, string] }
): Project {
  if (tpl === 'blank') return project;
  const rename = (map: Partial<Record<string, string>>) => project.tracks.map((t) => (map[t.type] ? { ...t, name: map[t.type]! } : t));
  if (tpl === 'podcast') {
    return {
      ...project,
      tracks: rename({ voiceover: names.voice, music: names.music, sfx: names.sfx }),
      // a zene a beszéd alatt halkul (az „automatikus halkítás” klipeknél ez a kulcs-sáv)
      audioMaster: { ...masterPreset('podcast'), duckTrigger: 'voiceover' },
    };
  }
  if (tpl === 'music') {
    const bpm = 120;
    const bar = (4 * 60) / bpm;
    const [intro, verse, chorus, outro] = names.sections;
    const markers: Marker[] = [
      { id: 'tpl_m1', time: 0, label: intro },
      { id: 'tpl_m2', time: 4 * bar, label: verse },
      { id: 'tpl_m3', time: 12 * bar, label: chorus },
      { id: 'tpl_m4', time: 20 * bar, label: outro },
    ];
    return { ...project, bpm, timeSignature: { beatsPerBar: 4, beatUnit: 4 }, markers, audioMaster: masterPreset('music') };
  }
  // hangalámondás: a beszéd-sáv elöl, videós hangosság
  return { ...project, tracks: rename({ voiceover: names.voice }), audioMaster: masterPreset('video') };
}
