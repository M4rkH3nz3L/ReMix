const { audioExtractArgs } = require('./render');

const has = (args, flag, val) => {
  const i = args.indexOf(flag);
  return i >= 0 && (val === undefined || args[i + 1] === val);
};

describe('audioExtractArgs (hang-export codec + minőség)', () => {
  test('ismeretlen/hiányzó formátum → null', () => {
    expect(audioExtractArgs({})).toBeNull();
    expect(audioExtractArgs({ audioFormat: 'xyz' })).toBeNull();
  });

  test('WAV/FLAC = veszteségmentes (nincs -b:a)', () => {
    const wav = audioExtractArgs({ audioFormat: 'wav' });
    expect(wav).toEqual({
      ext: 'wav',
      args: ['-c:a', 'pcm_s16le', '-af', 'aresample=dither_method=triangular,aformat=sample_fmts=s16'],
    });
    const flac = audioExtractArgs({ audioFormat: 'flac' });
    expect(flac.ext).toBe('flac');
    expect(flac.args).not.toContain('-b:a');
  });

  test('24 bit kérhető, ilyenkor nincs 16 bites dither', () => {
    expect(audioExtractArgs({ audioFormat: 'wav', audioBitDepth: 24 }).args).toEqual(['-c:a', 'pcm_s24le']);
    expect(audioExtractArgs({ audioFormat: 'flac', audioBitDepth: 24 }).args).toContain('s32');
    expect(audioExtractArgs({ audioFormat: 'mp3', audioBitDepth: 24 }).args).not.toContain('-af');
  });

  test('ismeretlen mintavétel és csatornaszám nem jut az ffmpeg-ig', () => {
    expect(audioExtractArgs({ audioFormat: 'mp3', sampleRate: '44100;rm', channels: 7 }).args).not.toContain('-ar');
    expect(audioExtractArgs({ audioFormat: 'mp3', channels: 7 }).args).not.toContain('-ac');
    expect(audioExtractArgs({ audioFormat: 'mp3', sampleRate: 48000 }).args).toContain('48000');
  });

  test('veszteséges formátumok per-formátum alap-bitrátája', () => {
    expect(has(audioExtractArgs({ audioFormat: 'mp3' }).args, '-b:a', '192k')).toBe(true);
    expect(has(audioExtractArgs({ audioFormat: 'aac' }).args, '-b:a', '256k')).toBe(true);
    const opus = audioExtractArgs({ audioFormat: 'opus' });
    expect(opus.ext).toBe('opus');
    expect(opus.args).toContain('libopus');
    expect(has(opus.args, '-b:a', '192k')).toBe(true);
  });

  test('egyedi bitráta + 32–512 kbps közé szorítva', () => {
    expect(has(audioExtractArgs({ audioFormat: 'aac', audioBitrateKbps: 320 }).args, '-b:a', '320k')).toBe(true);
    expect(has(audioExtractArgs({ audioFormat: 'opus', audioBitrateKbps: 9999 }).args, '-b:a', '512k')).toBe(true);
    expect(has(audioExtractArgs({ audioFormat: 'mp3', audioBitrateKbps: 10 }).args, '-b:a', '32k')).toBe(true);
  });

  test('sampleRate (-ar) + channels (-ac) minden formátumra érvényes', () => {
    const wav = audioExtractArgs({ audioFormat: 'wav', sampleRate: 48000, channels: 1 });
    expect(has(wav.args, '-ar', '48000')).toBe(true);
    expect(has(wav.args, '-ac', '1')).toBe(true);
    const opus = audioExtractArgs({ audioFormat: 'opus', sampleRate: 44100, channels: 2 });
    expect(has(opus.args, '-ar', '44100')).toBe(true);
    expect(has(opus.args, '-ac', '2')).toBe(true);
  });
});
