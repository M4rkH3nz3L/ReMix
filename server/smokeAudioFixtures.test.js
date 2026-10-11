const { buildSmokeProjects, mediaUrisOf, SMOKE_AUDIO, DUR } = require('./smokeAudioFixtures');

describe('smokeAudioFixtures', () => {
  const fx = buildSmokeProjects();

  test('egyedi nevek + minden projektnek van legalább egy track+klip', () => {
    const names = fx.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
    expect(fx.length).toBeGreaterThanOrEqual(17);
    for (const { project } of fx) {
      expect(project.kind).toBe('audio');
      expect(project.tracks.length).toBeGreaterThan(0);
      const clips = project.tracks.flatMap((t) => t.clips);
      expect(clips.length).toBeGreaterThan(0);
      for (const c of clips) {
        expect(c.kind).toBe('audio');
        expect(typeof c.uri).toBe('string');
        expect(typeof c.volume).toBe('number');
      }
    }
  });

  test('determinisztikus (kétszeri build ugyanaz)', () => {
    expect(JSON.stringify(buildSmokeProjects())).toBe(JSON.stringify(buildSmokeProjects()));
  });

  test('mediaUrisOf a szimbolikus forrásokat gyűjti', () => {
    const base = fx.find((f) => f.name === 'baseline').project;
    expect(mediaUrisOf(base)).toEqual([SMOKE_AUDIO.MUSIC]);
    const mix = fx.find((f) => f.name === 'mix-3track').project;
    expect(mediaUrisOf(mix).sort()).toEqual([SMOKE_AUDIO.MUSIC, SMOKE_AUDIO.SFX, SMOKE_AUDIO.VOICE].sort());
  });

  test('lefedi a kulcs-funkciókat (volume/fade/pan/automation/fx/master/mix)', () => {
    const allClips = fx.flatMap((f) => f.project.tracks.flatMap((t) => t.clips));
    expect(allClips.some((c) => c.volume === 0.5)).toBe(true);
    expect(allClips.some((c) => c.fadeIn > 0 && c.fadeOut > 0)).toBe(true);
    expect(allClips.some((c) => c.pan === -1)).toBe(true);
    expect(allClips.some((c) => c.pan === 1)).toBe(true);
    expect(allClips.some((c) => c.keyframes && c.keyframes.volume)).toBe(true);
    expect(allClips.some((c) => c.audioFx && c.audioFx.highpass)).toBe(true);
    expect(allClips.some((c) => c.audioFx && c.audioFx.eq)).toBe(true);
    expect(allClips.some((c) => c.audioFx && c.audioFx.compressor)).toBe(true);
    expect(allClips.some((c) => c.audioFx && c.audioFx.reverb)).toBe(true);
    expect(allClips.some((c) => c.voiceEnhance)).toBe(true);
    expect(allClips.some((c) => c.deReverb)).toBe(true);
    expect(allClips.some((c) => c.autoDuck)).toBe(true);
    expect(fx.some((f) => f.project.audioMaster && f.project.audioMaster.multiband)).toBe(true);
    expect(fx.some((f) => f.project.tracks.length === 3)).toBe(true);
  });

  test('a master-fixture-ök expect.lufsTarget-ja a preset LUFS-szal egyezik', () => {
    for (const f of fx) {
      if (f.expect && f.expect.lufsTarget != null) {
        expect(f.project.audioMaster.lufs).toBe(f.expect.lufsTarget);
      }
    }
  });

  test('DUR = 3 és a klipek ehhez igazodnak', () => {
    expect(DUR).toBe(3);
    const base = fx.find((f) => f.name === 'baseline').project.tracks[0].clips[0];
    expect(base.duration).toBe(DUR);
  });
});
