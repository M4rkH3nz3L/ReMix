/** 📶 PRO-AUDIO 17/8: a sáv szintmérője a lejátszófejnél mér, a némított sáv üres, a túlvezérlés piros. */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet } from 'react-native';

import { ClipMarkers, LaneMeter, MasterMeter } from '@/components/studio/audio/LaneMeter';
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

describe('MasterMeter és ClipMarkers', () => {
  it('a master a sávok összegét mutatja: két fél szintű sáv együtt teli', async () => {
    const p = createEmptyProject('m', '1:1', undefined, 'audio');
    useEditorStore.getState().loadProject(
      { ...p, tracks: p.tracks.map((t) => (t.type === 'music' || t.type === 'sfx' ? { ...t, clips: [clip({ id: t.type })] } : t)) },
      []
    );
    useEditorStore.getState().setPlayhead(1);
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(<MasterMeter />);
    });
    await act(async () => {});
    expect(StyleSheet.flatten(r.root.findByProps({ testID: 'master-meter-fill' }).props.style).backgroundColor).toBe(palette.danger);
  });

  it('a vonalzó a teljes szintű szakaszt jelöli (2–4 mp), a fél szintűt nem', async () => {
    await mount([clip({ volume: 1 })], 0);
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(<ClipMarkers pxPerSec={10} />);
    });
    await act(async () => {});
    const markers = r.root.findAll((n) => n.props.testID === 'clip-marker' && typeof n.type !== 'string' && n.props.pointerEvents === 'none');
    expect(markers).toHaveLength(1);
    const st = StyleSheet.flatten(markers[0].props.style);
    expect(st.left).toBeCloseTo(20, 0);
    expect(st.width).toBeCloseTo(20, 0);
  });
});

