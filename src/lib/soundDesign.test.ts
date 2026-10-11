import { planSoundDesign, usedSfxIds, type SoundDesignInput } from '@/lib/soundDesign';

// 🔊 Sound Design AI (vágás/beat/accent → SFX-elhelyezés) pure regressziós pajzsa.

const input = (over: Partial<SoundDesignInput>): SoundDesignInput => ({
  cuts: [], beats: [], downbeats: [], accents: [], duration: 10, ...over,
});

const noOverlap = (ps: { start: number; duration: number }[], minGap = 0.35) => {
  const sorted = [...ps].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    expect(sorted[i].start).toBeGreaterThanOrEqual(sorted[i - 1].start + sorted[i - 1].duration + minGap - 1e-6);
  }
};

describe('planSoundDesign', () => {
  it('üres bemenet → nincs elhelyezés', () => {
    expect(planSoundDesign(input({}))).toEqual([]);
  });

  it('a határ-közeli (≤0.15 / ≥duration-0.1) vágásokat eldobja', () => {
    expect(planSoundDesign(input({ cuts: [0.1, 9.95] }))).toEqual([]);
  });

  it('a legerősebb vágás elé riser kerül (ha van hely)', () => {
    const ps = planSoundDesign(input({ cuts: [6], duration: 10 }));
    expect(ps.some((p) => p.sfxId === 'sfx-riser')).toBe(true);
  });

  it('az elhelyezések a projekten belül vannak, minGap-et tartanak és start szerint rendezettek', () => {
    const ps = planSoundDesign(input({ cuts: [2, 4, 6, 8], downbeats: [4], beats: [2, 4, 6, 8], duration: 12 }));
    for (const p of ps) {
      expect(p.start).toBeGreaterThanOrEqual(0);
      expect(p.start + p.duration).toBeLessThanOrEqual(12 + 0.011);
    }
    noOverlap(ps);
    const starts = ps.map((p) => p.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it('a maxPlacements korlát érvényesül', () => {
    const many = Array.from({ length: 30 }, (_, i) => 1 + i * 0.5);
    const ps = planSoundDesign(input({ cuts: many, duration: 40 }), { maxPlacements: 5 });
    expect(ps.length).toBeLessThanOrEqual(5);
  });

  it('felirat/overlay accent → pop a szabad helyre', () => {
    const ps = planSoundDesign(input({ accents: [5], duration: 10 }));
    expect(ps.map((p) => p.sfxId)).toContain('sfx-pop');
  });
});

describe('usedSfxIds', () => {
  it('a tervben szereplő SFX-ek egyedi listája', () => {
    const ps = planSoundDesign(input({ cuts: [3, 6], downbeats: [6], accents: [1], duration: 12 }));
    const ids = usedSfxIds(ps);
    expect(new Set(ids).size).toBe(ids.length); // duplikátum-mentes
  });
});
