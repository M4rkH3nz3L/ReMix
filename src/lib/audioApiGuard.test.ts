import { Platform } from 'react-native';

import { audioApiState, canUseAudioApi, markAudioApi, resetAudioApiStateForTests } from '@/lib/audioApiGuard';

/** 🎚️ PRO-VIDEO B24 — EGY állapot dönt a waveform és a dekódolás natív útjáról */

describe('audioApiGuard', () => {
  let saved = false;
  const store = { has: () => saved, save: () => { saved = true; } };
  beforeEach(() => {
    saved = false;
    resetAudioApiStateForTests(store);
  });

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

  it('A20: a bizonyítás ugyanazon a buildön a következő indításra is megmarad', () => {
    Platform.OS = 'ios';
    markAudioApi(true);
    expect(saved).toBe(true);
    // új munkamenet: az állapot törlődik, a tár marad
    resetAudioApiStateForTests(store);
    expect(canUseAudioApi({ background: true })).toBe(true);
  });

  it('bizonyítás nélkül az új munkamenet háttér-hívása továbbra is tilos iOS-en', () => {
    Platform.OS = 'ios';
    expect(canUseAudioApi({ background: true })).toBe(false);
    expect(saved).toBe(false);
  });
});
