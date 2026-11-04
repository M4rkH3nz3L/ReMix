/** 📶 PRO-AUDIO 17/8: a sáv szintmérője a lejátszófejnél mér, a némított sáv üres, a túlvezérlés piros. */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet } from 'react-native';

import { LaneMeter } from '@/components/studio/audio/LaneMeter';
import { palette } from '@/constants/editor';
import { createEmptyProject } from '@/lib/projectUtils';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip } from '@/types/project';

jest.mock('@/lib/waveform', () => ({
  getWaveform: jest.fn(async () => ({ duration: 4, peaksPerSecond: 2, peaks: [0.5, 0.5, 0.5, 0.5, 1, 1, 1, 1] })),
}));

const clip = (over: Partial<AudioClip>): AudioClip =>
  ({ kind: 'audio', id: 'a', uri: 'u', label: 'a', start: 0, duration: 4, trimIn: 0, sourceDuration: 4, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported', ...over }) as AudioClip;

async function mount(clips: AudioClip[], playhead: number) {
  const p = createEmptyProject('m', '1:1', undefined, 'audio');
  useEditorStore.getState().loadProject({ ...p, tracks: p.tracks.map((t) => (t.type === 'music' ? { ...t, clips } : t)) }, []);
  useEditorStore.getState().setPlayhead(playhead);
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<LaneMeter type="music" />);
  });
  await act(async () => {});
  return r;
}
const fill = (r: ReactTestRenderer) => StyleSheet.flatten(r.root.findByProps({ testID: 'lane-meter-fill-music' }).props.style);

describe('LaneMeter', () => {
  it('a lejátszófejnél a forrás csúcsa × a hangerő: fél szint = −6 dB', async () => {
    const r = await mount([clip({ volume: 1 })], 1);
    expect(fill(r).width).toBe(`${Math.round(((60 - 6.02) / 60) * 100)}%`);
    expect(fill(r).backgroundColor).not.toBe(palette.danger);
  });

  it('a teljes szintű szakasz piros (túlvezérlés)', async () => {
    const r = await mount([clip({ volume: 1 })], 2.5);
    expect(fill(r).backgroundColor).toBe(palette.danger);
  });

  it('a némított sáv mérője üres', async () => {
    const r = await mount([clip({ volume: 1 })], 1);
    // a projekt betöltése alaphelyzetbe állítja a monitorozást, ezért utána némítunk
    await act(async () => {
      useEditorStore.setState({ mutedTracks: ['music'], soloTracks: [] });
    });
    expect(fill(r).width).toBe('0%');
    useEditorStore.setState({ mutedTracks: [] });
  });
});
