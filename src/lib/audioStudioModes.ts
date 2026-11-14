/**
 * 🎛️ V10: az Audio Stúdió módjai — Gyors · Keverés · Zene · AI (expo-mentes, tiszta mag).
 *
 * A mód csak NÉZET (nem kerül a projektbe, nem undo-zható): a transzport-sor gombcsoportjai közül
 * a módhoz illők elöl, a többi a „Több” mögött — semmi nem vész el (döntés 2026-11-14). A mód
 * projektenként az eszközön marad; az új projekt a fajtájához illő módban nyílik (Zene → Zene).
 */

export type AudioStudioMode = 'quick' | 'mix' | 'music' | 'ai';
export const AUDIO_STUDIO_MODES: readonly AudioStudioMode[] = ['quick', 'mix', 'music', 'ai'];

/** a transzport-sor csoportjai (a lejátszás, az undo/redo és az idő-kijelző mindig látszik) */
export type TransportGroup =
  | 'instruments'
  | 'loop'
  | 'metronome'
  | 'range'
  | 'tempo'
  | 'zoom'
  | 'markers'
  | 'editModes'
  | 'assistant'
  | 'ab'
  | 'snap';

/** a „Több” alatti sorrend (rögzített — izommemória) */
export const TRANSPORT_ORDER: readonly TransportGroup[] = ['instruments', 'loop', 'metronome', 'range', 'tempo', 'zoom', 'markers', 'editModes', 'assistant', 'ab', 'snap'];

/** módonként az elöl álló csoportok, prioritási sorrendben */
export const MODE_FRONT: Record<AudioStudioMode, readonly TransportGroup[]> = {
  // felvétel, vágás, export: a vágási módok és a nagyítás
  quick: ['editModes', 'zoom', 'markers'],
  // keverés: A/B, hurok és tartomány a meghallgatáshoz, jelölők
  mix: ['ab', 'loop', 'range', 'markers', 'zoom'],
  // zene: hangszerek, tempó, metronóm, rács
  music: ['instruments', 'tempo', 'metronome', 'snap', 'loop', 'zoom'],
  // AI: az asszisztens elöl, mellette A/B az eredmény meghallgatásához
  ai: ['assistant', 'ab', 'editModes', 'zoom'],
};

export type TransportLayout = { front: TransportGroup[]; more: TransportGroup[] };

export function transportLayout(mode: AudioStudioMode): TransportLayout {
  const front = [...MODE_FRONT[mode]];
  return { front, more: TRANSPORT_ORDER.filter((g) => !front.includes(g)) };
}

export function isAudioStudioMode(v: unknown): v is AudioStudioMode {
  return typeof v === 'string' && (AUDIO_STUDIO_MODES as readonly string[]).includes(v);
}

/** a projekt induló módja: a mentett, különben a fajtájához illő (Zene-projekt / zene-munkaterület → Zene) */
export function initialAudioMode(saved: unknown, kind: string | undefined, workspace: string | undefined): AudioStudioMode {
  if (isAudioStudioMode(saved)) {
    return saved;
  }
  return kind === 'music' || workspace === 'music' ? 'music' : 'quick';
}

/** a projektenkénti mentés legfeljebb ennyi projektet tart (a legrégebbi esik ki) */
export const MAX_SAVED_MODES = 200;

export function rememberMode(map: Record<string, AudioStudioMode>, projectId: string, mode: AudioStudioMode): Record<string, AudioStudioMode> {
  const rest = Object.entries(map).filter(([id]) => id !== projectId);
  const kept = rest.slice(Math.max(0, rest.length - (MAX_SAVED_MODES - 1)));
  return Object.fromEntries([...kept, [projectId, mode]]);
}
