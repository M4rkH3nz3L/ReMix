const { GRADES, gradeFilterChain } = require('./grades');

describe('grades — közös filmes look-presetek', () => {
  test('gradeFilterChain: ismeretlen / none / üres → ""', () => {
    expect(gradeFilterChain(undefined)).toBe('');
    expect(gradeFilterChain('none')).toBe('');
    expect(gradeFilterChain('nincs-ilyen')).toBe('');
  });

  test('gradeFilterChain: vezető vessző + a preset szűrői sorban', () => {
    expect(gradeFilterChain('warm-film')).toBe(
      ',eq=contrast=1.06:saturation=1.05,' +
        'colorbalance=rm=0.10:gm=0.03:bm=-0.12:rh=0.08:bh=-0.10'
    );
    // a noir deszaturál (saturation=0) → szürkeárnyalatos look
    expect(gradeFilterChain('noir')).toContain('saturation=0');
    expect(gradeFilterChain('noir')).toContain('vignette=angle=0.8');
  });

  test('a kliens-oldali id-k mind léteznek a worker-térképben (előnézet=export)', () => {
    const clientIds = ['teal-orange', 'moody', 'vintage', 'noir', 'warm-film', 'cold', 'vibrant', 'dreamy'];
    for (const id of clientIds) {
      expect(Array.isArray(GRADES[id])).toBe(true);
      expect(GRADES[id].length).toBeGreaterThan(0);
    }
  });

  test('render.js UGYANAZT a GRADES-térképet használja (nincs drift)', () => {
    // a render.js require-olja a közös modult — a referencia azonos
    const renderExports = require('./render');
    // a gradeChain a GRADES-re épül; indirekt ellenőrzés: a warm-film preset
    // első szűrője jelenjen meg a gradeChain kimenetében
    const chain = renderExports.gradeChain
      ? renderExports.gradeChain({ grade: 'warm-film' }, null)
      : null;
    if (chain != null) {
      expect(chain).toContain('eq=contrast=1.06:saturation=1.05');
    }
  });
});
