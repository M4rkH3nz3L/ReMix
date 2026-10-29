import { Platform } from 'react-native';

import { audioApiState, canUseAudioApi, markAudioApi, resetAudioApiStateForTests } from '@/lib/audioApiGuard';

/** 🎚️ PRO-VIDEO B24 — EGY állapot dönt a waveform és a dekódolás natív útjáról */

describe('audioApiGuard', () => {
  beforeEach(() => resetAudioApiStateForTests());

  it('iOS: a háttér-hívás (waveform) csak bizonyított modullal; a user-hívás próbálkozhat', () => {
    Platform.OS = 'ios';
    expect(canUseAudioApi({ background: true })).toBe(false);
    expect(canUseAudioApi()).toBe(true);
    markAudioApi(true);
    expect(canUseAudioApi({ background: true })).toBe(true);
    // egy későbbi fájl-hiba nem veszi el a bizonyított állapotot
    markAudioApi(false);
    expect(audioApiState()).toBe('ok');
  });

  it('a sikertelen import után végleg lemond (minden hívónál)', () => {
    Platform.OS = 'android';
    expect(canUseAudioApi({ background: true })).toBe(true);
    markAudioApi(false);
    expect(canUseAudioApi()).toBe(false);
    expect(canUseAudioApi({ background: true })).toBe(false);
  });
});
