import {
  audioExtOf,
  AUDIO_INTAKE_WARN_SEC,
  classifyAudioIntake,
  isSupportedAudio,
} from '@/lib/audioIntake';

describe('audioExtOf — kiterjesztés kisbetűvel, query/hash nélkül', () => {
  it('normál', () => expect(audioExtOf('file:///a/song.MP3')).toBe('mp3'));
  it('query/hash', () => expect(audioExtOf('https://x/y.m4a?token=1#t')).toBe('m4a'));
  it('nincs kiterjesztés', () => expect(audioExtOf('content://media/42')).toBe(''));
  it('üres', () => expect(audioExtOf('')).toBe(''));
});

describe('isSupportedAudio — támogatott formátum-kapu', () => {
  it.each(['mp3', 'm4a', 'aac', 'wav', 'flac', 'opus', 'ogg', 'aiff', 'caf'])('támogatott: %s', (ext) => {
    expect(isSupportedAudio(`file:///x.${ext}`)).toBe(true);
  });
  it('ismeretlen kiterjesztés → false', () => {
    expect(isSupportedAudio('file:///x.wma')).toBe(false);
    expect(isSupportedAudio('file:///x.txt')).toBe(false);
  });
  it('kiterjesztés/protokoll nélkül → true (a natív dönt)', () => {
    expect(isSupportedAudio('content://media/42')).toBe(true);
    expect(isSupportedAudio('')).toBe(true);
  });
});

describe('classifyAudioIntake — barátságos osztályozás', () => {
  it('nem támogatott → hard-stop (ok=false), nincs warning', () => {
    const r = classifyAudioIntake({ uri: 'file:///x.wma', name: 'régi.wma', durationSec: 120 });
    expect(r.ok).toBe(false);
    expect(r.warning).toBe(false);
    expect(r.reason).toBe('unsupported');
    expect(r.message).toMatch(/nem tudjuk beolvasni/);
  });

  it('ismeretlen hossz (0) → behozható, de figyelmeztet', () => {
    const r = classifyAudioIntake({ uri: 'file:///x.mp3', durationSec: 0 });
    expect(r.ok).toBe(true);
    expect(r.warning).toBe(true);
    expect(r.reason).toBe('unknownDuration');
  });

  it('NaN hossz → unknownDuration', () => {
    expect(classifyAudioIntake({ uri: 'file:///x.mp3' }).reason).toBe('unknownDuration');
  });

  it('túl hosszú (>3h) → behozható, de figyelmeztet', () => {
    const r = classifyAudioIntake({ uri: 'file:///x.wav', durationSec: AUDIO_INTAKE_WARN_SEC + 1 });
    expect(r.ok).toBe(true);
    expect(r.warning).toBe(true);
    expect(r.reason).toBe('tooLong');
    expect(r.message).toMatch(/óra/);
  });

  it('normál hang → ok, nincs figyelmeztetés', () => {
    const r = classifyAudioIntake({ uri: 'file:///x.flac', name: 'dal.flac', durationSec: 180 });
    expect(r).toEqual({ ok: true, warning: false });
  });
});
