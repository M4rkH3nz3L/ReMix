import {
  keepsFromSilences,
  planSilenceCut,
  planSilenceCutFromTranscript,
  silencesFromSpeech,
} from '@/lib/silencePlan';
import type { Project, Track, VideoClip } from '@/types/project';

/**
 * 🔇 VAD→vágásterv (local-ai Fázis A/3): determinista, frame-rácsos, paraméteres.
 */

function videoClip(partial: Partial<VideoClip> = {}): VideoClip {
  return {
    kind: 'video',
    id: 'clip_1',
    start: 0,
    duration: 10,
    uri: 'file://a.mp4',
    trimIn: 0,
    sourceDuration: 10,
    speed: 1,
    volume: 1,
    filterId: 'none',
    ...partial,
  };
}

function fixtureProject(clips: VideoClip[], fps = 30): Project {
  const track: Track = { id: 't_video', type: 'video', name: 'Videó', clips };
  return {
    id: 'proj_test',
    name: 'Teszt',
    aspectRatio: '9:16',
    fps,
    tracks: [track],
    assets: [],
    createdAt: '2026-10-22T00:00:00.000Z',
    updatedAt: '2026-10-22T00:00:00.000Z',
    schemaVersion: 6,
  };
}

describe('silencesFromSpeech', () => {
  it('a beszéd-szegmensek közti elég hosszú rések csendek, pad-dal', () => {
    const silences = silencesFromSpeech(
      [
        { start: 1, end: 3 },
        { start: 6, end: 8 },
      ],
      10,
      { padSec: 0.1, minSilenceSec: 0.5 },
    );
    expect(silences).toEqual([
      { start: 0, end: 0.9 },
      { start: 3.1, end: 5.9 },
      { start: 8.1, end: 10 },
    ]);
  });

  it('a minSilenceSec-nél rövidebb rés NEM csend (levegővétel marad)', () => {
    const silences = silencesFromSpeech(
      [
        { start: 0, end: 4.8 },
        { start: 5.2, end: 10 },
      ],
      10,
      { padSec: 0, minSilenceSec: 0.6 },
    );
    expect(silences).toEqual([]);
  });

  it('átfedő beszéd-szegmensek összeolvadnak', () => {
    const silences = silencesFromSpeech(
      [
        { start: 1, end: 5 },
        { start: 4, end: 6 },
      ],
      10,
      { padSec: 0, minSilenceSec: 0.5 },
    );
    expect(silences).toEqual([
      { start: 0, end: 1 },
      { start: 6, end: 10 },
    ]);
  });

  it('beszéd nélkül nincs vágás (nem vágjuk ki az egész videót)', () => {
    expect(silencesFromSpeech([], 10)).toEqual([]);
  });
});

describe('keepsFromSilences', () => {
  it('a keep-határok a frame-rácson ülnek', () => {
    const keeps = keepsFromSilences(
      [{ start: 2.3333, end: 4.1111 }],
      10,
      30,
      { minKeepSec: 0.1 },
    );
    for (const k of keeps) {
      // 30 fps-en a határ 1/30 többszöröse (lebegő-tűréssel)
      expect(Math.abs(k.start * 30 - Math.round(k.start * 30))).toBeLessThan(1e-9);
      expect(Math.abs(k.end * 30 - Math.round(k.end * 30))).toBeLessThan(1e-9);
    }
    expect(keeps).toHaveLength(2);
  });

  it('a minKeepSec-nél rövidebb darab kiesik', () => {
    const keeps = keepsFromSilences(
      [
        { start: 0.1, end: 5 },
        { start: 5.15, end: 10 },
      ],
      10,
      30,
      { minKeepSec: 0.25 },
    );
    // a 0–0.1 és az 5–5.15 darab túl rövid
    expect(keeps).toEqual([]);
  });
});

describe('planSilenceCut', () => {
  it('középső csend kivágása: 1 klipből 2 darab, trimIn-folytonossággal, EGY parancsban', () => {
    const project = fixtureProject([videoClip({ duration: 10, sourceDuration: 10 })]);
    const plan = planSilenceCut(
      project,
      [
        { start: 0, end: 4 },
        { start: 7, end: 10 },
      ],
      { padSec: 0, minSilenceSec: 0.5 },
    )!;
    expect(plan).not.toBeNull();
    expect(plan.commands).toHaveLength(1);
    const cmd = plan.commands[0];
    expect(cmd.type).toBe('REPLACE_TRACK_CLIPS');
    if (cmd.type !== 'REPLACE_TRACK_CLIPS') {
      return;
    }
    expect(cmd.trackType).toBe('video');
    expect(cmd.clips).toHaveLength(2);
    const [a, b] = cmd.clips as VideoClip[];
    // az új idővonal hézagmentes
    expect(a.start).toBe(0);
    expect(a.duration).toBeCloseTo(4, 5);
    expect(b.start).toBeCloseTo(4, 5);
    expect(b.duration).toBeCloseTo(3, 5);
    // a második darab a forrás 7. mp-énél folytatódik
    expect(b.trimIn).toBeCloseTo(7, 5);
    expect(plan.removedSec).toBeCloseTo(3, 5);
    expect(plan.cuts).toBe(1);
  });

  it('determinista: azonos bemenet → azonos keep-lista', () => {
    const project = fixtureProject([videoClip()]);
    const speech = [
      { start: 0.5, end: 3.2 },
      { start: 6.1, end: 9.4 },
    ];
    const p1 = planSilenceCut(project, speech)!;
    const p2 = planSilenceCut(project, speech)!;
    expect(p1.keeps).toEqual(p2.keeps);
    expect(p1.removedSec).toBe(p2.removedSec);
  });

  it('nincs elég hosszú csend → null (nincs üres undo-lépés)', () => {
    const project = fixtureProject([videoClip()]);
    expect(planSilenceCut(project, [{ start: 0, end: 10 }])).toBeNull();
  });

  it('beszéd nélkül → null', () => {
    const project = fixtureProject([videoClip()]);
    expect(planSilenceCut(project, [])).toBeNull();
  });
});

describe('planSilenceCutFromTranscript (teljes on-device lánc)', () => {
  it('whisper-sorokból csend-vágás terv: a hosszú rés kiesik, a kis szünet marad', () => {
    const project = fixtureProject([videoClip({ duration: 10, sourceDuration: 10 })]);
    const plan = planSilenceCutFromTranscript(project, [
      { start: 0.3, end: 2.0, text: 'szia, ez az eleje' },
      { start: 2.3, end: 3.8, text: 'ez még ugyanaz a gondolat' }, // 0.3 mp rés → összeolvad
      { start: 8.0, end: 9.6, text: 'ez pedig a vége' }, // 4+ mp rés → csend kiesik
    ])!;
    expect(plan).not.toBeNull();
    const cmd = plan.commands[0];
    expect(cmd.type).toBe('REPLACE_TRACK_CLIPS');
    if (cmd.type !== 'REPLACE_TRACK_CLIPS') {
      return;
    }
    // két beszéd-blokk marad → két klip-darab, a köztes csend kivágva
    expect(cmd.clips).toHaveLength(2);
    expect(plan.removedSec).toBeGreaterThan(3);
  });

  it('üres átirat → null (fallback a hívóé)', () => {
    const project = fixtureProject([videoClip()]);
    expect(planSilenceCutFromTranscript(project, [])).toBeNull();
  });
});
