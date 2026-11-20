import type { TFunction } from 'i18next';
import { Alert } from 'react-native';

import { useEditorStore } from '@/store/editorStore';
import type { TrackType } from '@/types/project';

import { openMarkerMenu, openRangeMenu, openSnapMenu, openTrackMenu, type TrackMenuState } from './timelineMenus';

// a TransportBar az expo-routert húzná be (jestben nem fordul) — a színléptetést itt csak
// a bekötéshez nézzük (a jest a mockot az importok elé emeli)
jest.mock('@/components/editor/TransportBar', () => ({
  nextMarkerColor: (c?: string) => `next(${c ?? '-'})`,
}));

/** a kulcsot adja vissza — így a gomb-sorrend és a feliratok kulcsai közvetlenül ellenőrizhetők */
const t = ((k: string) => k) as unknown as TFunction;

type Btn = { text: string; onPress?: () => void; style?: string };
const lastButtons = (spy: jest.SpyInstance): Btn[] => spy.mock.calls[spy.mock.calls.length - 1][2];

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => {
  alertSpy.mockRestore();
});

const trackState = (over: Partial<TrackMenuState> = {}): TrackMenuState => ({
  mutedTracks: [],
  soloTracks: [],
  lockedTracks: [],
  collapsedTracks: [],
  hiddenTracks: [],
  autoTrackHeight: false,
  toggleTrackFlag: jest.fn(),
  cycleTrackHeight: jest.fn(),
  toggleAutoTrackHeight: jest.fn(),
  ...over,
});

describe('openTrackMenu', () => {
  it('videósáv: némítás + szóló + láthatóság + zár + összecsukás + magasság + auto + mégse, ebben a sorrendben', () => {
    openTrackMenu(t, 'video', trackState());
    expect(alertSpy).toHaveBeenCalledWith('editor.track.video', 'editor.timeline.trackMenuMessage', expect.any(Array));
    expect(lastButtons(alertSpy).map((b) => b.text)).toEqual([
      'editor.timeline.mute',
      'editor.timeline.soloOn',
      'editor.timeline.hide',
      'editor.timeline.lock',
      'editor.timeline.collapse',
      'editor.timeline.height',
      'editor.timeline.autoHeightOn',
      'common.cancel',
    ]);
  });

  it('hangsávon nincs láthatóság, szöveg-sávon nincs némítás/szóló', () => {
    openTrackMenu(t, 'music', trackState());
    expect(lastButtons(alertSpy).map((b) => b.text)).not.toContain('editor.timeline.hide');
    openTrackMenu(t, 'text', trackState());
    const texts = lastButtons(alertSpy).map((b) => b.text);
    expect(texts).not.toContain('editor.timeline.mute');
    expect(texts[0]).toBe('editor.timeline.hide');
  });

  it('a bekapcsolt jelzők a visszakapcsoló feliratot adják', () => {
    const type: TrackType = 'video';
    openTrackMenu(
      t,
      type,
      trackState({
        mutedTracks: [type],
        soloTracks: [type],
        hiddenTracks: [type],
        lockedTracks: [type],
        collapsedTracks: [type],
        autoTrackHeight: true,
      })
    );
    expect(lastButtons(alertSpy).map((b) => b.text)).toEqual([
      'editor.timeline.unmute',
      'editor.timeline.soloOff',
      'editor.timeline.show',
      'editor.timeline.unlock',
      'editor.timeline.expand',
      'editor.timeline.height',
      'editor.timeline.autoHeightOff',
      'common.cancel',
    ]);
  });

  it('a gombok a megfelelő store-akciót hívják', () => {
    const st = trackState();
    openTrackMenu(t, 'video', st);
    const btns = lastButtons(alertSpy);
    btns.forEach((b) => b.onPress?.());
    expect((st.toggleTrackFlag as jest.Mock).mock.calls).toEqual([
      ['video', 'mute'],
      ['video', 'solo'],
      ['video', 'hidden'],
      ['video', 'lock'],
      ['video', 'collapse'],
    ]);
    expect(st.cycleTrackHeight).toHaveBeenCalledWith('video');
    expect(st.toggleAutoTrackHeight).toHaveBeenCalledTimes(1);
    expect(btns[btns.length - 1].style).toBe('cancel');
  });
});

describe('openSnapMenu', () => {
  it('az öt célpont-fajta pipával jelölve, a koppintás a kulcsot kapcsolja', () => {
    const toggle = jest.fn();
    openSnapMenu(t, { playhead: true, clips: false, markers: true, beats: false, regions: true }, toggle);
    const btns = lastButtons(alertSpy);
    expect(btns.map((b) => b.text)).toEqual([
      '✓ editor.snap.targetPlayhead',
      '  editor.snap.targetClips',
      '✓ editor.snap.targetMarkers',
      '  editor.snap.targetBeats',
      '✓ editor.snap.targetRegions',
      'common.done',
    ]);
    btns[3].onPress?.();
    expect(toggle).toHaveBeenCalledWith('beats');
  });
});

describe('openRangeMenu', () => {
  it('régió / törlés (destruktív) / ürítés / mégse', () => {
    const actions = { regionFromRange: jest.fn(), deleteRange: jest.fn(), clearRange: jest.fn() };
    openRangeMenu(t, actions);
    const btns = lastButtons(alertSpy);
    expect(btns.map((b) => [b.text, b.style])).toEqual([
      ['editor.range.region', undefined],
      ['editor.range.delete', 'destructive'],
      ['editor.range.clear', undefined],
      ['common.cancel', 'cancel'],
    ]);
    btns.slice(0, 3).forEach((b) => b.onPress?.());
    expect(actions.regionFromRange).toHaveBeenCalledTimes(1);
    expect(actions.deleteRange).toHaveBeenCalledTimes(1);
    expect(actions.clearRange).toHaveBeenCalledTimes(1);
  });
});

describe('openMarkerMenu', () => {
  const dispatch = jest.fn();
  let getStateSpy: jest.SpyInstance;
  beforeEach(() => {
    dispatch.mockReset();
    getStateSpy = jest.spyOn(useEditorStore, 'getState').mockReturnValue({
      project: { markers: [{ id: 'm1', time: 1, label: 'Intro', color: undefined }, { id: 'm2', time: 2, label: 'B' }] },
      dispatch,
    } as unknown as ReturnType<typeof useEditorStore.getState>);
  });
  afterEach(() => getStateSpy.mockRestore());

  it('ismeretlen jelölőre nem nyit menüt', () => {
    openMarkerMenu(t, 'nincs');
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('a törlés a SET_MARKERS paranccsal megy a command buson (a többi jelölő marad)', () => {
    openMarkerMenu(t, 'm1');
    const [title, message] = alertSpy.mock.calls[0];
    expect(title).toBe('Intro');
    expect(message).toBe('editor.marker.menuMessage');
    const del = lastButtons(alertSpy).find((b) => b.text === 'common.delete');
    expect(del?.style).toBe('destructive');
    del?.onPress?.();
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_MARKERS', markers: [{ id: 'm2', time: 2, label: 'B' }] });
  });

  it('az átszínezés a következő jelölő-színt írja be, ugyanazzal a paranccsal', () => {
    openMarkerMenu(t, 'm1');
    lastButtons(alertSpy)
      .find((b) => b.text === 'editor.transportBar.recolorMarker')
      ?.onPress?.();
    const cmd = dispatch.mock.calls[0][0];
    expect(cmd.type).toBe('SET_MARKERS');
    expect(cmd.markers[0]).toEqual({ id: 'm1', time: 1, label: 'Intro', color: 'next(-)' });
    expect(cmd.markers[1]).toEqual({ id: 'm2', time: 2, label: 'B' });
  });
});
