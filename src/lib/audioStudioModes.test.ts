import { AUDIO_STUDIO_MODES, initialAudioMode, MAX_SAVED_MODES, MODE_FRONT, rememberMode, TRANSPORT_ORDER, transportLayout } from '@/lib/audioStudioModes';

describe('audioStudioModes — V10 Gyors · Keverés · Zene · AI', () => {
  test('minden módban minden csoport elérhető: elöl vagy a „Több” alatt, pontosan egyszer', () => {
    for (const m of AUDIO_STUDIO_MODES) {
      const { front, more } = transportLayout(m);
      expect([...front, ...more].sort()).toEqual([...TRANSPORT_ORDER].sort());
      expect(new Set([...front, ...more]).size).toBe(TRANSPORT_ORDER.length);
      expect(front).toEqual([...MODE_FRONT[m]]);
    }
  });

  test('a módok jellege: Zene → hangszerek elöl; AI → asszisztens elöl; Gyors rövid', () => {
    expect(transportLayout('music').front[0]).toBe('instruments');
    expect(transportLayout('ai').front[0]).toBe('assistant');
    expect(transportLayout('quick').front.length).toBeLessThanOrEqual(3);
    expect(transportLayout('quick').more).toContain('instruments');
    // a „Több” a rögzített sorrendet követi
    const more = transportLayout('mix').more;
    expect(more).toEqual(TRANSPORT_ORDER.filter((g) => more.includes(g)));
  });

  test('induló mód: mentett > Zene-projekt / zene-munkaterület → Zene > Gyors', () => {
    expect(initialAudioMode('mix', 'music', 'music')).toBe('mix');
    expect(initialAudioMode(undefined, 'music', undefined)).toBe('music');
    expect(initialAudioMode(undefined, 'audio', 'music')).toBe('music');
    expect(initialAudioMode(undefined, 'audio', undefined)).toBe('quick');
    expect(initialAudioMode('bogus', 'audio', undefined)).toBe('quick');
  });

  test('projektenkénti mentés: felülír, a legrégebbit ejti a plafonnál', () => {
    let m = rememberMode({}, 'a', 'mix');
    m = rememberMode(m, 'b', 'music');
    m = rememberMode(m, 'a', 'ai');
    expect(m).toEqual({ b: 'music', a: 'ai' });
    for (let i = 0; i < MAX_SAVED_MODES + 10; i++) m = rememberMode(m, `p${i}`, 'quick');
    expect(Object.keys(m)).toHaveLength(MAX_SAVED_MODES);
    expect(m.a).toBeUndefined();
    expect(m[`p${MAX_SAVED_MODES + 9}`]).toBe('quick');
  });
});
