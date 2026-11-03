import { setAudioModeAsync } from 'expo-audio';

import { startVoiceRecording, stopVoiceRecording, voiceoverClip } from '@/lib/voiceRecording';

jest.mock('expo-audio', () => ({ setAudioModeAsync: jest.fn(async () => {}) }));
jest.mock('@/lib/media', () => ({ persistToLibrary: (uri: string) => uri.replace('cache', 'project') }));

const recorder = (over: Record<string, unknown> = {}) => {
  const r = {
    uri: 'file:///cache/rec.m4a',
    getStatus: () => ({ durationMillis: 2340, isRecording: true }),
    stop: jest.fn(async () => {}),
    prepareToRecordAsync: jest.fn(async () => {}),
    record: jest.fn(),
    ...over,
  };
  return r as unknown as Parameters<typeof stopVoiceRecording>[0] & typeof r;
};

beforeEach(() => jest.clearAllMocks());

describe('voiceRecording (A43)', () => {
  it('a leállítás után a lejátszó-mód visszaáll (különben iOS-en elnémul a lejátszás)', async () => {
    const r = recorder();
    await expect(stopVoiceRecording(r)).resolves.toEqual({ uri: 'file:///project/rec.m4a', seconds: 2.34 });
    expect(setAudioModeAsync).toHaveBeenLastCalledWith({ allowsRecording: false, playsInSilentMode: true });
  });

  it('a lejátszó-mód akkor is visszaáll, ha a leállítás hibát dob', async () => {
    const r = recorder({ stop: jest.fn(async () => { throw new Error('stop'); }) });
    await expect(stopVoiceRecording(r)).rejects.toThrow('stop');
    expect(setAudioModeAsync).toHaveBeenLastCalledWith({ allowsRecording: false, playsInSilentMode: true });
  });

  it('az indítás felvételi módba kapcsol, aztán rögzít', async () => {
    const r = recorder();
    await startVoiceRecording(r);
    expect(setAudioModeAsync).toHaveBeenCalledWith({ allowsRecording: true, playsInSilentMode: true });
    expect(r.record).toHaveBeenCalled();
  });

  it('a klip a frame-rácsra ül, és van trimIn + sourceDuration', () => {
    const { clip, asset } = voiceoverClip('file:///p/rec.m4a', 2.34, 1.01, 30, 'Hang', () => 'id1');
    expect(clip).toMatchObject({ start: 1, duration: 2.34, trimIn: 0, sourceDuration: 2.34, source: 'voiceover', uri: 'file:///p/rec.m4a' });
    expect(asset).toMatchObject({ kind: 'audio', uri: 'file:///p/rec.m4a', duration: 2.34 });
  });
});
