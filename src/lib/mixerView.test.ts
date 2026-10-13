import {
  audioClipIds,
  canDuckTrack,
  clampGain,
  faderToGain,
  formatGainDb,
  gainToDb,
  gainToFader,
  isVoiceTrack,
  MAX_GAIN,
  trackDucked,
} from '@/lib/mixerView';
import type { Clip } from '@/types/project';

const audio = (id: string, autoDuck?: boolean): Clip =>
  ({ kind: 'audio', id, start: 0, duration: 5, uri: `f://${id}`, label: id, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported', ...(autoDuck ? { autoDuck: true } : {}) }) as Clip;

describe('mixerView — gain/dB/fader', () => {
  it('clampGain: 0…MAX, érvénytelen → 1', () => {
    expect(clampGain(-1)).toBe(0);
    expect(clampGain(5)).toBe(MAX_GAIN);
    expect(clampGain(1)).toBe(1);
    expect(clampGain(NaN)).toBe(1);
  });
  it('gainToDb / formatGainDb', () => {
    expect(gainToDb(1)).toBeCloseTo(0, 6);
    expect(gainToDb(2)).toBeCloseTo(6.0206, 3);
    expect(formatGainDb(1)).toBe('0.0');
    expect(formatGainDb(2)).toBe('+6.0');
    expect(formatGainDb(0.5)).toBe('-6.0');
    expect(formatGainDb(0)).toBe('-∞');
  });
  it('fader ↔ gain oda-vissza', () => {
    expect(faderToGain(0.5)).toBe(1);
    expect(faderToGain(1)).toBe(MAX_GAIN);
    expect(gainToFader(1)).toBe(0.5);
    expect(gainToFader(MAX_GAIN)).toBe(1);
  });
});

describe('mixerView — sidechain duck', () => {
  it('isVoiceTrack / canDuckTrack', () => {
    expect(isVoiceTrack('voiceover')).toBe(true);
    expect(canDuckTrack('voiceover')).toBe(false);
    expect(canDuckTrack('music')).toBe(true);
    expect(canDuckTrack('sfx')).toBe(true);
  });
  it('trackDucked: van klip ÉS mind autoDuck', () => {
    expect(trackDucked([audio('a', true), audio('b', true)])).toBe(true);
    expect(trackDucked([audio('a', true), audio('b')])).toBe(false);
    expect(trackDucked([])).toBe(false);
  });
  it('audioClipIds: csak a hang-klipek', () => {
    const vid = { kind: 'video', id: 'v', start: 0, duration: 1 } as unknown as Clip;
    expect(audioClipIds([audio('a'), vid, audio('b')])).toEqual(['a', 'b']);
  });
});
