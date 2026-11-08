/** 🎚️🤖 Mixjavaslat-lap: az alkalmazás egy visszavonás; visszavonás után a javaslat újra alkalmazható, a master-mérés eltűnik. */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { MixAssistSheet } from '@/components/studio/audio/MixAssistSheet';
import { masterPreset } from '@/lib/audioMaster';
import { runDevAction } from '@/lib/devActions';
import { createEmptyProject } from '@/lib/projectUtils';
import { useEditorStore } from '@/store/editorStore';
import { useMixAssist } from '@/store/mixAssistStore';
import type { AudioClip } from '@/types/project';

jest.mock('react-native-worklets', () => ({ runOnJS: (fn: unknown) => fn, scheduleOnRN: (fn: (...a: unknown[]) => void, ...a: unknown[]) => fn(...a) }));
jest.mock('react-native-reanimated', () => {
  const RN = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: { View: RN.View, createAnimatedComponent: (c: unknown) => c },
    runOnJS: (fn: unknown) => fn,
    Easing: new Proxy({}, { get: () => () => () => 0 }),
    withTiming: (v: unknown) => v,
    withSpring: (v: unknown) => v,
    useSharedValue: (value: unknown) => ({ value }),
    useAnimatedStyle: (fn: () => object) => fn(),
    useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
    useEvent: () => () => {},
    useComposedEventHandler: () => undefined,
    setGestureState: () => {},
  };
});
jest.mock('react-native-safe-area-context', () => {
  const RN = jest.requireActual('react-native');
  return { SafeAreaView: RN.View };
});
jest.mock('@/lib/mixAssistClient', () => ({
  analyzeMixTracks: jest.fn(async () => ({ tracks: {}, mix: { peak: 0.5, lufs: -20, momentary: [-20, -20], blocks: [-20, -20], speech: { lufs: -20, momentary: [-20, -20], blocks: [-20, -20] }, band: { low: -6, mid: -3, high: -9 } } })),
  measureMastered: jest.fn(async () => ({ peak: 0.85, lufs: -14.2, momentary: [-14, -14], blocks: [], speech: { lufs: -14, momentary: [], blocks: [] }, band: { low: -6, mid: -3, high: -9 } })),
}));
jest.mock('@/lib/mixAssist', () => {
  const actual = jest.requireActual('@/lib/mixAssist');
  return {
    ...actual,
    // egy javaslat: felüláteresztő a beszédre — csak ha még nincs rajta (mint a valódi magban)
    mixSuggestions: (p: { tracks: { type: string; clips: AudioClip[] }[] }) => {
      const v = p.tracks.find((t) => t.type === 'voiceover')!.clips[0];
      return v.audioFx?.highpass ? [] : [{ key: 'highpassVoice', severity: 'warn', params: {}, commands: [{ type: 'UPDATE_CLIP', clipId: v.id, patch: { audioFx: { ...v.audioFx, highpass: 80 } } }] }];
    },
  };
});
jest.mock('@/store/progressStore', () => ({ withCancellableProgress: (_l: string, fn: (r: () => void, s: AbortSignal) => Promise<unknown>) => fn(() => {}, new AbortController().signal) }));

describe('MixAssistSheet', () => {
  it('alkalmazás → egy visszavonás mindent visszaállít, a javaslat újra alkalmazható; a master-mérés visszavonás után nem látszik', async () => {
    const base = createEmptyProject('mix', '9:16', undefined, 'audio');
    const clip: AudioClip = { kind: 'audio', id: 'v', label: 'beszéd', uri: 'file:///v.wav', start: 0, duration: 5, trimIn: 0, sourceDuration: 5, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' };
    useEditorStore.getState().loadProject({ ...base, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [clip] } : t)) });
    const st = useEditorStore.getState;
    const before = JSON.stringify(st().project);
    let r!: ReactTestRenderer;
    await act(async () => {
      useMixAssist.getState().show('mix');
      r = create(<MixAssistSheet />);
    });
    await act(async () => {
      await runDevAction('mixAssist.reanalyze');
    });
    expect(runDevAction('mixAssist.suggestions')).toEqual(['highpassVoice']);
    let n = 0;
    act(() => {
      n = runDevAction('mixAssist.applyAll') as number;
    });
    const after = JSON.stringify(st().project);
    expect(n).toBe(1);
    expect(st().events.at(-1)?.actor).toBe('ai');
    // a javaslat-lista az elemzés pillanatáé (nem a projekté): az alkalmazott javaslat ✓-et kap
    expect(runDevAction('mixAssist.appliedKeys')).toEqual(['highpassVoice']);
    act(() => st().undo());
    expect(JSON.stringify(st().project)).toBe(before);
    expect(runDevAction('mixAssist.appliedKeys')).toEqual([]);
    act(() => st().redo());
    expect(JSON.stringify(st().project)).toBe(after);
    act(() => st().undo());
    // a visszavont javaslat újra alkalmazható (régen „✓” maradt és le volt tiltva)
    act(() => {
      n = runDevAction('mixAssist.applyAll') as number;
    });
    expect(n).toBe(1);
    expect(JSON.stringify(st().project)).toBe(after);
    act(() => st().undo());

    // master: alkalmazás + mérés látszik; visszavonás után a projekt az eredeti, a mérés nem látszik
    await act(async () => {
      await runDevAction('mixAssist.applyMaster');
    });
    expect(st().project!.audioMaster).toEqual(expect.objectContaining({ target: masterPreset('youtube').target }));
    expect(runDevAction('mixAssist.verifiedShown')).toBe(true);
    act(() => st().undo());
    expect(JSON.stringify(st().project)).toBe(before);
    expect(runDevAction('mixAssist.verifiedShown')).toBe(false);
    act(() => r.unmount());
  });
});
