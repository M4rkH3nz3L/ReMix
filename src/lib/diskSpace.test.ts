import {
  canStartRecording,
  EXPORT_SPACE_MARGIN,
  hasRoomFor,
  isDiskFullError,
  megabytes,
  mustStopRecording,
  RECORD_START_MIN_FREE,
  RECORD_STOP_FREE,
  wavBytes,
} from './diskSpace';

describe('diskSpace', () => {
  it('a WAV mérete: 1 perc sztereó 44,1 kHz ≈ 10,1 MB', () => {
    expect(wavBytes(44100 * 60, 2)).toBe(44 + 44100 * 60 * 4);
    expect(megabytes(wavBytes(44100 * 60, 2))).toBe(11);
  });

  it('az export a tartalékkal együtt fér el', () => {
    const need = wavBytes(44100 * 60, 2);
    expect(hasRoomFor(need, need + EXPORT_SPACE_MARGIN)).toBe(true);
    expect(hasRoomFor(need, need + EXPORT_SPACE_MARGIN - 1)).toBe(false);
  });

  it('ismeretlen szabad hely nem tilt', () => {
    expect(hasRoomFor(1e12, 0)).toBe(true);
    expect(hasRoomFor(1e12, Number.NaN)).toBe(true);
    expect(canStartRecording(0)).toBe(true);
    expect(mustStopRecording(0)).toBe(false);
  });

  it('felvétel: kevés helynél nem indul, fogyáskor lezárul', () => {
    expect(canStartRecording(RECORD_START_MIN_FREE)).toBe(true);
    expect(canStartRecording(RECORD_START_MIN_FREE - 1)).toBe(false);
    expect(mustStopRecording(RECORD_STOP_FREE)).toBe(false);
    expect(mustStopRecording(RECORD_STOP_FREE - 1)).toBe(true);
    // a kettő között felvétel fut, de új nem indul
    expect(RECORD_STOP_FREE).toBeLessThan(RECORD_START_MIN_FREE);
  });

  it('a betelt lemez hibája felismerhető', () => {
    expect(isDiskFullError(new Error('UnexpectedException: No space left on device'))).toBe(true);
    expect(isDiskFullError(new Error('NSCocoaErrorDomain Code=640 "You can’t save the file because the volume is out of space."'))).toBe(true);
    expect(isDiskFullError(new Error('Nincs elég szabad hely a készüléken.'))).toBe(true);
    expect(isDiskFullError(new Error('A(z) x.wav hangfájl nem olvasható be'))).toBe(false);
    expect(isDiskFullError(new Error('timeout 6400 ms'))).toBe(false);
  });
});
