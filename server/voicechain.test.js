const fs = require('fs');

const {
  VOICE_ENHANCE,
  dereverbChain,
  voiceChain,
  audioFxChain,
  panFilter,
  masterGraph,
  masterEq,
  masterLra,
  dbToLinear,
  RNNOISE,
} = require('./voicechain');

// 🎙️ A render audio-láncának regressziós pajzsa (06 §2.7): a Pro-audio effekt-
// lánc (EQ/kompresszor/limiter/denoise/pan/reverb) FFmpeg-szűrő-stringjei
// determinisztikusak és sorrend-érzékenyek — egy csendes elcsúszás más hangot
// égetne a renderbe. Ez a teszt leszögezi a kimenetet (ffmpeg nem kell hozzá).

describe('audioFxChain — per-klip Pro-audio lánc', () => {
  it('nincs fx / üres → üres string', () => {
    expect(audioFxChain(null)).toBe('');
    expect(audioFxChain(undefined)).toBe('');
    expect(audioFxChain({})).toBe('');
  });

  it('highpass/lowpass: kerekít + Hz-tartományra szorít', () => {
    expect(audioFxChain({ highpass: 80.4 })).toBe('highpass=f=80,');
    expect(audioFxChain({ lowpass: 12000 })).toBe('lowpass=f=12000,');
    // szorítás: highpass 20..2000, lowpass 1000..20000
    expect(audioFxChain({ highpass: 5 })).toBe('highpass=f=20,');
    expect(audioFxChain({ lowpass: 99999 })).toBe('lowpass=f=20000,');
    // 0 / negatív → kihagyva
    expect(audioFxChain({ highpass: 0, lowpass: 0 })).toBe('');
  });

  it('EQ: csak a nem-nulla sávok, ±12 dB-re szorítva', () => {
    expect(audioFxChain({ eq: { low: 0, mid: 0, high: 0 } })).toBe('');
    expect(audioFxChain({ eq: { low: 3, mid: 0, high: -4 } })).toBe(
      'equalizer=f=100:t=q:w=1:g=3,equalizer=f=8000:t=q:w=1:g=-4,'
    );
    expect(audioFxChain({ eq: { low: 99, mid: -99, high: 0 } })).toBe(
      'equalizer=f=100:t=q:w=1:g=12,equalizer=f=1000:t=q:w=1:g=-12,'
    );
  });

  it('kapcsolós szűrők pontos stringje', () => {
    expect(audioFxChain({ denoise: true })).toBe('afftdn=nf=-25,');
    expect(audioFxChain({ deEsser: true })).toBe('deesser,');
    expect(audioFxChain({ compressor: true })).toBe(
      'acompressor=threshold=-18dB:ratio=3:attack=5:release=150,'
    );
    expect(audioFxChain({ normalize: true })).toBe('loudnorm=I=-16:TP=-1.5:LRA=11,');
    expect(audioFxChain({ limiter: true })).toBe('alimiter=limit=0.95,');
  });

  it('reverb/delay (aecho) a mértékből számolt paraméterekkel', () => {
    // reverb=0.5 → dec=0.55, második 0.39 (0.55*0.7=0.385→0.39)
    expect(audioFxChain({ reverb: 0.5 })).toBe('aecho=0.8:0.9:40|75:0.55|0.39,');
    // delay=0.5 → delay ms = 120+0.5*380 = 310, decay = 0.2+0.5*0.5 = 0.45
    expect(audioFxChain({ delay: 0.5 })).toBe('aecho=0.8:0.6:310:0.45,');
    expect(audioFxChain({ reverb: 0, delay: 0 })).toBe('');
  });

  it('SORREND: szűrők → zaj/sziszegés → dinamika → tér → normalizálás → limiter', () => {
    const out = audioFxChain({
      highpass: 80,
      lowpass: 12000,
      eq: { low: 2, mid: 0, high: 0 },
      denoise: true,
      deEsser: true,
      compressor: true,
      reverb: 0.5,
      delay: 0.5,
      normalize: true,
      limiter: true,
    });
    expect(out).toBe(
      'highpass=f=80,lowpass=f=12000,equalizer=f=100:t=q:w=1:g=2,' +
        'afftdn=nf=-25,deesser,acompressor=threshold=-18dB:ratio=3:attack=5:release=150,' +
        'aecho=0.8:0.9:40|75:0.55|0.39,aecho=0.8:0.6:310:0.45,' +
        'loudnorm=I=-16:TP=-1.5:LRA=11,alimiter=limit=0.95,'
    );
  });
});

describe('panFilter — sztereó pásztázás', () => {
  it('0 / hiányzó → üres', () => {
    expect(panFilter(0)).toBe('');
    expect(panFilter(undefined)).toBe('');
  });
  it('teljes bal (−1): a bal csatorna marad, a jobb lenémul', () => {
    expect(panFilter(-1)).toBe('aformat=channel_layouts=stereo,pan=stereo|c0=1.000*c0|c1=0.000*c1,');
  });
  it('teljes jobb (1): a jobb csatorna marad', () => {
    expect(panFilter(1)).toBe('aformat=channel_layouts=stereo,pan=stereo|c0=0.000*c0|c1=1.000*c1,');
  });
  it('±1-re szorít', () => {
    expect(panFilter(-5)).toBe(panFilter(-1));
    expect(panFilter(5)).toBe(panFilter(1));
  });
});

describe('voiceChain — beszéd-javító csomag', () => {
  it('üres beállítás → üres string', () => {
    expect(voiceChain({})).toBe('');
  });
  it('voiceEnhance → a VOICE_ENHANCE záró vessző nélkül', () => {
    expect(voiceChain({ voiceEnhance: true })).toBe(VOICE_ENHANCE.replace(/,$/, ''));
  });
  it('deReverb → a dereverbChain záró vessző nélkül', () => {
    expect(voiceChain({ deReverb: true })).toBe(dereverbChain().replace(/,$/, ''));
  });
  it('mindkettő → dereverb + voice-enhance, záró vessző nélkül', () => {
    const expected = (dereverbChain() + VOICE_ENHANCE).replace(/,$/, '');
    expect(voiceChain({ voiceEnhance: true, deReverb: true })).toBe(expected);
  });
});

describe('dereverbChain — a modell meglététől függő prefix', () => {
  it('mindig tartalmazza a kaput + a doboz-EQ-t, és az arnndn a modell meglétét követi', () => {
    const chain = dereverbChain();
    expect(chain).toContain('agate=threshold=0.02:ratio=2.5:attack=8:release=90,');
    expect(chain).toContain('equalizer=f=300:t=q:w=1.2:g=-3,');
    expect(chain.startsWith('arnndn=')).toBe(fs.existsSync(RNNOISE));
  });
});

describe('master-helperek', () => {
  it('masterLra: natural=11, punchy=5, egyébként 7', () => {
    expect(masterLra('natural')).toBe(11);
    expect(masterLra('punchy')).toBe(5);
    expect(masterLra('smooth')).toBe(7);
    expect(masterLra(undefined)).toBe(7);
  });

  it('dbToLinear: 0 dB → 1, +6 dB ≈ 1.995, −6 dB ≈ 0.501 (3 tizedes)', () => {
    expect(dbToLinear(0)).toBe(1);
    expect(dbToLinear(6)).toBeCloseTo(1.995, 3);
    expect(dbToLinear(-6)).toBeCloseTo(0.501, 3);
  });

  it('masterEq: csak a nem-nulla sávok (bass/equalizer/treble); mind 0 → üres', () => {
    expect(masterEq(undefined)).toBe('');
    expect(masterEq({ low: 0, mid: 0, high: 0 })).toBe('');
    expect(masterEq({ low: 2, mid: 0, high: -3 })).toBe('bass=g=2:f=110,treble=g=-3:f=8000');
    expect(masterEq({ low: 0, mid: 4, high: 0 })).toBe('equalizer=f=1000:width_type=q:w=1:g=4');
  });
});

describe('masterGraph — mérés előtti master-gráf', () => {
  it('EQ nélkül, multiband nélkül → anull passthrough', () => {
    expect(masterGraph({ eq: null, multiband: false })).toBe('[0:a]anull[meq];[meq]anull[mst]');
  });
  it('EQ-val, multiband nélkül → az EQ-node + passthrough', () => {
    expect(masterGraph({ eq: { low: 2, mid: 0, high: 0 }, multiband: false })).toBe(
      '[0:a]bass=g=2:f=110[meq];[meq]anull[mst]'
    );
  });
  it('multiband → 3-sávos split + sávonkénti kompresszor + amix', () => {
    const g = masterGraph({ eq: null, multiband: true }, 'out');
    expect(g).toContain('[0:a]anull[meq];');
    expect(g).toContain('[meq]asplit=3[b1][b2][b3];');
    expect(g).toContain('[b1]lowpass=f=250,');
    expect(g).toContain('[b2]highpass=f=250,lowpass=f=4000,');
    expect(g).toContain('[b3]highpass=f=4000,');
    expect(g).toContain('[c1][c2][c3]amix=inputs=3:normalize=0[out]');
  });
  it('egyedi out-node név', () => {
    expect(masterGraph({ eq: null, multiband: false }, 'xyz')).toBe('[0:a]anull[meq];[meq]anull[xyz]');
  });
});
