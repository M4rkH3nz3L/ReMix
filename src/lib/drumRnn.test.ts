import { DrumRnn, labelsToPattern, parseDrumRnnWeights, patternToLabels, seededRandom, type DrumRnnVars } from '@/lib/drumRnn';

/** kis véletlen modell a szerkezet ellenőrzéséhez (a valódi súlyok a katalógusból jönnek; a magenta-js-sel
 * való egyezés a fejlesztéskor mérve: valószínűség-eltérés 1,2e-7, 16/16 azonos lépés) */
function tinyVars(H = 4, C = 16, bits = 6, layers = 2): DrumRnnVars {
  const rnd = seededRandom(7);
  const t = (...shape: number[]) => ({ data: Float32Array.from({ length: shape.reduce((a, b) => a * b, 1) }, () => (rnd() - 0.5) * 0.8), shape });
  const P = 'rnn/attention_cell_wrapper/';
  const inSize = C + bits;
  const v: DrumRnnVars = {
    [`${P}kernel`]: t(inSize + H, inSize),
    [`${P}bias`]: t(inSize),
    [`${P}attention/attn_w`]: t(1, 1, H, H),
    [`${P}attention/attn_v`]: t(H),
    [`${P}attention/kernel`]: t(2 * layers * H, H),
    [`${P}attention/bias`]: t(H),
    [`${P}attention_output_projection/kernel`]: t(2 * H, H),
    [`${P}attention_output_projection/bias`]: t(H),
    'fully_connected/weights': t(H, C),
    'fully_connected/biases': t(C),
  };
  for (let l = 0; l < layers; l++) {
    v[`${P}multi_rnn_cell/cell_${l}/basic_lstm_cell/kernel`] = t((l === 0 ? inSize : H) + H, 4 * H);
    v[`${P}multi_rnn_cell/cell_${l}/basic_lstm_cell/bias`] = t(4 * H);
  }
  return v;
}

describe('drumRnn — V8 AI-dob (Magenta Drums RNN, tiszta JS)', () => {
  test('a méretek a súlyokból; argmax determinisztikus; a címkék tartományban', () => {
    const m = new DrumRnn(tinyVars(), { attnLength: 3 });
    expect([m.hidden, m.classes, m.inputSize]).toEqual([4, 16, 22]);
    const a = m.continue([1, 0, 3], 12);
    expect(a.labels).toHaveLength(12);
    expect(a.labels.every((x) => Number.isInteger(x) && x >= 0 && x < 16)).toBe(true);
    expect(m.continue([1, 0, 3], 12).labels).toEqual(a.labels);
  });

  test('mintavétel: azonos magból azonos; a valószínűségek összege 1; alacsony hőmérséklet élesebb', () => {
    const m = new DrumRnn(tinyVars(), { attnLength: 3 });
    const r1 = m.continue([2], 20, 1, seededRandom(42), true);
    expect(m.continue([2], 20, 1, seededRandom(42)).labels).toEqual(r1.labels);
    for (const p of r1.probs) expect(p.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 5);
    const ent = (p: Float32Array) => -p.reduce((s, x) => s + (x > 0 ? x * Math.log(x) : 0), 0);
    const cold = m.continue([2], 1, 0.3, seededRandom(1), true).probs[0];
    const hot = m.continue([2], 1, 1.5, seededRandom(1), true).probs[0];
    expect(ent(cold)).toBeLessThan(ent(hot));
  });

  test('a figyelem-bias kapcsoló számít (TF-hű út ≠ bias nélkül)', () => {
    const v = tinyVars();
    const a = new DrumRnn(v, { attnLength: 3 }).continue([1, 2], 4, undefined, Math.random, true).probs[0];
    const b = new DrumRnn(v, { attnLength: 3, attentionBias: false }).continue([1, 2], 4, undefined, Math.random, true).probs[0];
    expect(Math.max(...a.map((x, i) => Math.abs(x - b[i])))).toBeGreaterThan(1e-6);
  });

  test('RXW1 fájl: fejléc + float32 → változók', () => {
    const vars = { a: { offset: 0, shape: [2, 2] }, b: { offset: 4, shape: [3] } };
    let head = new TextEncoder().encode(JSON.stringify({ vars }));
    const pad = (4 - (head.length % 4)) % 4;
    head = Uint8Array.from([...head, ...new Array(pad).fill(32)]);
    const buf = new ArrayBuffer(8 + head.length + 7 * 4);
    new Uint8Array(buf).set([82, 88, 87, 49], 0);
    new DataView(buf).setUint32(4, head.length, true);
    new Uint8Array(buf).set(head, 8);
    new Float32Array(buf, 8 + head.length, 7).set([1, 2, 3, 4, 5, 6, 7]);
    const p = parseDrumRnnWeights(buf);
    expect(Array.from(p.a.data)).toEqual([1, 2, 3, 4]);
    expect(Array.from(p.b.data)).toEqual([5, 6, 7]);
    expect(() => parseDrumRnnWeights(new ArrayBuffer(16))).toThrow();
  });

  test('kódolás: a dobgép hangjai ↔ Magenta-osztályok (a clap/rim pergő, a nyitott hi-hat hangsúlyos hi-hat)', () => {
    const labels = patternToLabels({ kick: [true, false, false, false], snare: [false, false, true, false], clap: [false, false, true, false], hihat: [true, true, true, true] }, 4);
    expect(labels).toEqual([1 | 4, 4, 2 | 4, 4]);
    const back = labelsToPattern([1 | 8, 2 | 16 | 128, 256, 0]);
    expect(back.pattern.kick).toEqual([true, false, false, false]);
    expect(back.pattern.hihat).toEqual([true, false, false, false]);
    expect(back.accents.hihat).toEqual([0]);
    expect(back.pattern.tom[1] && back.pattern.crash[1] && back.pattern.snare[1]).toBe(true);
    expect(back.pattern.perc[2]).toBe(true);
  });
});
