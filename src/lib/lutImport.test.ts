import { parseCubeLut } from '@/lib/lutImport';

const CUBE_2 = `# egy 2x2x2 3D LUT
TITLE "Teal Orange"
LUT_3D_SIZE 2
DOMAIN_MIN 0 0 0
DOMAIN_MAX 1 1 1
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1`;

describe('lutImport — parseCubeLut', () => {
  it('érvényes 3D .cube (size^3 sor)', () => {
    const r = parseCubeLut(CUBE_2);
    expect(r.ok).toBe(true);
    expect(r.lut).toMatchObject({ title: 'Teal Orange', dim: '3D', size: 2 });
    expect(r.lut!.data).toHaveLength(8); // 2^3
    expect(r.lut!.data[0]).toEqual([0, 0, 0]);
    expect(r.lut!.data[7]).toEqual([1, 1, 1]);
  });

  it('1D LUT (size sor)', () => {
    const r = parseCubeLut('LUT_1D_SIZE 3\n0 0 0\n0.5 0.5 0.5\n1 1 1');
    expect(r.ok).toBe(true);
    expect(r.lut).toMatchObject({ dim: '1D', size: 3 });
    expect(r.lut!.data).toHaveLength(3);
  });

  it('hiányzó méret → no_size', () => {
    expect(parseCubeLut('0 0 0\n1 1 1').error?.code).toBe('no_size');
  });

  it('rossz adatszám → wrong_count', () => {
    const r = parseCubeLut('LUT_3D_SIZE 2\n0 0 0\n1 1 1'); // 2 sor, 8 kellene
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('wrong_count');
  });

  it('hibás adat-sor → bad_row', () => {
    const r = parseCubeLut('LUT_1D_SIZE 2\n0 0 x\n1 1 1');
    expect(r.error?.code).toBe('bad_row');
  });
});
