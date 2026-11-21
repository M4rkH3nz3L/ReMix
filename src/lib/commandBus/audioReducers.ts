import { normalizeTempoMap } from '@/lib/audioTransport';
import type { Project } from '@/types/project';

import type { CommandOf } from './types';

/** 🎚️ Hang-reducerek: ütemjelzés, tempó, BPM, master, sáv-gain/sidechain, buszok és küldések. */

export function reduceSetTimeSignature(project: Project, cmd: CommandOf<'SET_TIME_SIGNATURE'>): Project | null {
  const ts = { beatsPerBar: Math.max(1, Math.min(16, Math.round(cmd.timeSignature.beatsPerBar))), beatUnit: cmd.timeSignature.beatUnit === 8 ? 8 : 4 } as const;
  const cur = project.timeSignature ?? { beatsPerBar: 4, beatUnit: 4 };
  if (cur.beatsPerBar === ts.beatsPerBar && cur.beatUnit === ts.beatUnit) {
    return null;
  }
  return { ...project, timeSignature: ts };
}

export function reduceSetTrackSidechain(project: Project, cmd: CommandOf<'SET_TRACK_SIDECHAIN'>): Project | null {
  const cur = project.trackMix?.[cmd.trackType];
  const sc = cmd.sidechain && cmd.sidechain.from !== cmd.trackType ? { from: cmd.sidechain.from, ratio: Math.max(2, Math.min(20, Math.round(cmd.sidechain.ratio * 10) / 10)) } : null;
  if (JSON.stringify(cur?.sidechain ?? null) === JSON.stringify(sc)) return null;
  const gain = cur?.gain ?? 1;
  return { ...project, trackMix: { ...project.trackMix, [cmd.trackType]: { gain, ...(sc ? { sidechain: sc } : {}) } } };
}

export function reduceSetBpm(project: Project, cmd: CommandOf<'SET_BPM'>): Project | null {
  const bpm = Math.max(20, Math.min(300, Math.round(cmd.bpm)));
  if ((project.bpm ?? 120) === bpm) {
    return null;
  }
  return { ...project, bpm };
}

export function reduceSetTempoMap(project: Project, cmd: CommandOf<'SET_TEMPO_MAP'>): Project | null {
  const next = normalizeTempoMap(cmd.tempoMap);
  const cur = normalizeTempoMap(project.tempoMap);
  if (JSON.stringify(next) === JSON.stringify(cur)) return null;
  if (next.length === 0) {
    const { tempoMap: _drop, ...rest } = project;
    return rest as Project;
  }
  return { ...project, tempoMap: next };
}

export function reduceSetAudioMaster(project: Project, cmd: CommandOf<'SET_AUDIO_MASTER'>): Project | null {
  const next = cmd.audioMaster;
  if (JSON.stringify(project.audioMaster ?? null) === JSON.stringify(next ?? null)) {
    return null;
  }
  return { ...project, audioMaster: next ?? undefined };
}

export function reduceSetTrackGain(project: Project, cmd: CommandOf<'SET_TRACK_GAIN'>): Project | null {
  const g = Math.max(0, Math.min(1, cmd.gain));
  const prev = project.trackMix ?? {};
  if ((prev[cmd.trackType]?.gain ?? 1) === g) {
    return null;
  }
  // a sáv többi beállítása (pl. a V9 sidechain) megmarad
  return { ...project, trackMix: { ...prev, [cmd.trackType]: { ...prev[cmd.trackType], gain: g } } };
}

export function reduceSetAudioBuses(project: Project, cmd: CommandOf<'SET_AUDIO_BUSES'>): Project | null {
  // a törölt buszra szóló küldések is eltűnnek
  const ids = new Set(cmd.buses.map((b) => b.id));
  const audioSends = Object.fromEntries(
    Object.entries(project.audioSends ?? {}).map(([tt, sends]) => [tt, Object.fromEntries(Object.entries(sends ?? {}).filter(([id]) => ids.has(id)))])
  ) as Project['audioSends'];
  return { ...project, audioBuses: cmd.buses, audioSends };
}

export function reduceSetTrackSend(project: Project, cmd: CommandOf<'SET_TRACK_SEND'>): Project | null {
  const amount = Math.max(0, Math.min(1, cmd.amount));
  const prev = project.audioSends?.[cmd.trackType] ?? {};
  if ((prev[cmd.busId] ?? 0) === amount || !(project.audioBuses ?? []).some((b) => b.id === cmd.busId)) {
    return null;
  }
  return { ...project, audioSends: { ...project.audioSends, [cmd.trackType]: { ...prev, [cmd.busId]: amount } } };
}
