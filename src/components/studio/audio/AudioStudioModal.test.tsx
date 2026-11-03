/** 🎧 A45: a videóból nyitott Hang Stúdió nem zárul be, ha a fókusz-klipjét törlik. */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Modal } from 'react-native';

import { AudioStudioModal } from '@/components/studio/audio/AudioStudioModal';
import { createEmptyProject } from '@/lib/projectUtils';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip } from '@/types/project';

jest.mock('@/components/studio/audio/AudioStudioBody', () => ({ AudioStudioBody: () => null }));
jest.mock('@/hooks/useBackLayer', () => ({ useBackLayer: () => {} }));

const clip: AudioClip = { kind: 'audio', id: 'a1', uri: 'file:///a.m4a', label: 'a', start: 0, duration: 2, trimIn: 0, sourceDuration: 2, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' };
const visible = (r: ReactTestRenderer) => r.root.findByType(Modal).props.visible;

describe('AudioStudioModal (A45)', () => {
  it('a fókusz-klip törlése után nyitva marad, a bezárás zárja', () => {
    const base = createEmptyProject('v', '9:16');
    useEditorStore.getState().loadProject({ ...base, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [clip] } : t)) }, []);
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<AudioStudioModal />);
    });
    expect(visible(r)).toBe(false);
    act(() => useEditorStore.getState().openAudioStudio('a1'));
    expect(visible(r)).toBe(true);
    act(() => {
      useEditorStore.getState().removeClip('a1');
    });
    expect(visible(r)).toBe(true);
    act(() => useEditorStore.getState().closeAudioStudio());
    expect(visible(r)).toBe(false);
  });

  it('nem hangklipre (vagy nem létező klipre) nem nyílik', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<AudioStudioModal />);
    });
    act(() => useEditorStore.getState().openAudioStudio('nincs-ilyen'));
    expect(visible(r)).toBe(false);
  });
});
