const {
  buildSmokeProjects,
  mediaUrisOf,
  projectDurationOf,
  SMOKE_MEDIA,
} = require('./smokeFixtures');

// 🎬 A render-parity smoke FIXTURE-ök szerkezeti pajzsa (a runner IO-ja nélkül):
// minden projekt valid + RÖVID (≤15 mp → in-process render) + csak ismert
// szimbolikus médiát hivatkoz.

const KNOWN = new Set(Object.values(SMOKE_MEDIA));

describe('buildSmokeProjects', () => {
  const projects = buildSmokeProjects();

  it('nem üres + egyedi nevek', () => {
    expect(projects.length).toBeGreaterThanOrEqual(12);
    const names = projects.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('minden fixture: valid projekt (video-sáv + klipek alapmezői)', () => {
    for (const { name, project } of projects) {
      expect(project.tracks.some((t) => t.type === 'video')).toBe(true);
      for (const track of project.tracks) {
        for (const clip of track.clips) {
          expect(typeof clip.id).toBe('string');
          expect(typeof clip.kind).toBe('string');
          expect(typeof clip.start).toBe('number');
          expect(clip.duration).toBeGreaterThan(0);
        }
      }
      expect(project.fps).toBeGreaterThan(0);
      expect(name).toBeTruthy();
    }
  });

  it('minden fixture ≤ 15 mp (a szerver IN-PROCESS rendereli — nem kell worker/queue)', () => {
    for (const { project } of projects) {
      expect(projectDurationOf(project)).toBeLessThanOrEqual(15);
    }
  });

  it('a hivatkozott média-uri-k mind ISMERT szimbolikusak (a runner generálja őket)', () => {
    for (const { project } of projects) {
      for (const uri of mediaUrisOf(project)) {
        expect(KNOWN.has(uri)).toBe(true);
      }
    }
  });

  it('van legalább egy funkció-fixture a kulcs-render-utakra', () => {
    const names = buildSmokeProjects().map((p) => p.name);
    for (const must of ['keyframe-rotate-opacity', 'color-grade', 'effect-chain', 'skew', 'reverse', 'transition-xfade', 'animated-mask', 'pip', 'particles', 'color-balance-3way']) {
      expect(names).toContain(must);
    }
  });
});

describe('projectDurationOf', () => {
  it('a leghosszabb sáv-vég', () => {
    const p = { tracks: [{ clips: [{ start: 0, duration: 2 }, { start: 5, duration: 3 }] }] };
    expect(projectDurationOf(p)).toBe(8);
  });
  it('üres → 0', () => {
    expect(projectDurationOf({ tracks: [] })).toBe(0);
  });
});
