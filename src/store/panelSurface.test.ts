import { selectSurfaceTier, useEditorStore } from '@/store/editorStore';
import type { AudioClip, Clip, Project, Track, TrackType, VideoClip } from '@/types/project';

/**
 * 📐 MOBILE-UI §3 — a panel felület-szintjének store-oldala: detent-memória,
 * Strip → Sheet kibontás, és a Focus-szint (regiszterből SZÁMOLT, nem tárolt).
 */

function videoClip(id: string): VideoClip {
  return {
    id, kind: 'video', start: 0, duration: 5,
    uri: `file:///${id}.mp4`, trimIn: 0, sourceDuration: 5,
    speed: 1, volume: 1, filterId: 'none',
  };
}
function audioClip(id: string): AudioClip {
  return { id, kind: 'audio', start: 0, duration: 5, uri: `file:///${id}.m4a`, trimIn: 0, sourceDuration: 5, volume: 1 } as AudioClip;
}
function track(type: TrackType, clips: Clip[] = []): Track {
  return { id: `trk-${type}`, type, name: type, clips };
}
function makeProject(): Project {
  return {
    id: 'p1', name: 'Teszt', aspectRatio: '9:16', fps: 30,
    tracks: [track('video', [videoClip('v1')]), track('music', [audioClip('a1')])],
    assets: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 6,
  };
}

const store = () => useEditorStore.getState();
beforeEach(() => store().loadProject(makeProject()));
afterEach(() => store().closeProject());

describe('panel felület-szint (store)', () => {
  it('nincs panel → null', () => {
    expect(selectSurfaceTier(store())).toBeNull();
  });

  it('Strip-panel összecsukva nyílik, a „Részletek" sheet-re bontja', () => {
    store().selectClip('v1');
    store().setPanel('speed');
    expect(selectSurfaceTier(store())).toBe('strip');
    store().expandPanel();
    expect(selectSurfaceTier(store())).toBe('sheet');
    expect(store().panelDetent).toBe('half');
  });

  it('újranyitáskor a Strip megint összecsukva indul', () => {
    store().selectClip('v1');
    store().setPanel('speed');
    store().expandPanel();
    store().setPanel(null);
    store().setPanel('speed');
    expect(selectSurfaceTier(store())).toBe('strip');
  });

  it('a hangerő-strip csak kijelölt hangklipre él; klip nélkül sheet (zene-hozzáadás)', () => {
    store().setPanel('audio');
    expect(selectSurfaceTier(store())).toBe('sheet');
    store().selectClip('a1');
    expect(selectSurfaceTier(store())).toBe('strip');
  });

  it('a precíziós panel Focus-szintű; bezárva nem ragad be', () => {
    store().selectClip('v1');
    store().setPanel('precision');
    expect(selectSurfaceTier(store())).toBe('focus');
    store().selectClip(null);
    expect(selectSurfaceTier(store())).toBeNull();
  });

  it('canFocus lap: ideiglenesen Focus-ba vált, a „Kész" visszahozza a laphoz', () => {
    store().loadProject({
      ...makeProject(),
      tracks: [
        ...makeProject().tracks,
        track('interactive', [
          {
            id: 'h1', kind: 'interactive', start: 0, duration: 3, label: 'H',
            rect: { x: 0.3, y: 0.3, w: 0.2, h: 0.2 }, action: { type: 'url', url: '' },
          } as Clip,
        ]),
      ],
    });
    store().selectClip('h1');
    store().setPanel('hotspot');
    expect(selectSurfaceTier(store())).toBe('sheet');
    store().setPanelFocus(true);
    expect(selectSurfaceTier(store())).toBe('focus');
    store().setPanelFocus(false);
    expect(selectSurfaceTier(store())).toBe('sheet');
  });

  it('nem-canFocus panelnél a Focus-kérés hatástalan; panelváltás törli', () => {
    store().setPanel('captions');
    store().setPanelFocus(true);
    expect(selectSurfaceTier(store())).toBe('sheet');
    store().setPanel('library');
    expect(store().panelFocus).toBe(false);
  });

  it('a detent-választás panelenként megmarad (session)', () => {
    store().setPanel('captions');
    expect(store().panelDetent).toBe('half'); // regiszter kezdő
    store().setPanelDetent('full');
    store().setPanel('library');
    expect(store().panelDetent).toBe('half');
    store().setPanel('captions');
    expect(store().panelDetent).toBe('full');
  });

  it('a panel nyitása/zárása nem bántja a playheadet és a zoomot', () => {
    store().setPlayhead(3.2);
    store().setZoom(2);
    store().setPanel('captions');
    store().setPanelDetent('full');
    store().setPanel(null);
    expect(store().playhead).toBeCloseTo(3.2, 5);
    expect(store().zoom).toBe(2);
  });
});
