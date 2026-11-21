/**
 * 🔴 Az élő adás képernyőjének expo-mentes számításai (REFACTOR: a src/app/live/[id].tsx-ből) —
 * a bontás előtti kifejezések viselkedését rögzítik, a határesetekkel együtt.
 */
import type { LiveChat } from '@/lib/live';
import { addScene, addSource, createLiveDoc, setActiveScene, toggleSourceVisible } from '@/lib/liveDoc';
import {
  appendLiveChat,
  appendLiveFloat,
  flipFacing,
  formatLiveElapsed,
  liveElapsedSeconds,
  quickGridSources,
  showsEndedView,
} from '@/lib/liveSessionOps';
import { initialLiveState, type LiveState } from '@/lib/liveState';

describe('liveElapsedSeconds', () => {
  it('egész másodpercekre lefelé kerekít', () => {
    expect(liveElapsedSeconds(1000, 1999)).toBe(0);
    expect(liveElapsedSeconds(1000, 2000)).toBe(1);
    expect(liveElapsedSeconds(1000, 62_500)).toBe(61);
  });
  it('óra-visszaugrásnál sem negatív', () => {
    expect(liveElapsedSeconds(5000, 1000)).toBe(0);
  });
});

describe('formatLiveElapsed', () => {
  it('egy óra alatt m:ss (a perc nincs kitöltve)', () => {
    expect(formatLiveElapsed(0)).toBe('0:00');
    expect(formatLiveElapsed(9)).toBe('0:09');
    expect(formatLiveElapsed(61)).toBe('1:01');
    expect(formatLiveElapsed(3599)).toBe('59:59');
  });
  it('egy órától h:mm:ss', () => {
    expect(formatLiveElapsed(3600)).toBe('1:00:00');
    expect(formatLiveElapsed(3661)).toBe('1:01:01');
    expect(formatLiveElapsed(36_000 + 59)).toBe('10:00:59');
  });
});

describe('appendLiveChat / appendLiveFloat', () => {
  const msg = (i: number): LiveChat => ({ id: `m${i}`, name: 'n', avatar: null, text: `t${i}`, at: i });
  it('a chat legfeljebb 80 korábbi üzenetet tart meg + az újat (81)', () => {
    let list: LiveChat[] = [];
    for (let i = 0; i < 100; i++) list = appendLiveChat(list, msg(i));
    expect(list).toHaveLength(81);
    expect(list[0].id).toBe('m19');
    expect(list[80].id).toBe('m99');
  });
  it('a chat-lista nem mutálódik', () => {
    const prev = [msg(1)];
    const next = appendLiveChat(prev, msg(2));
    expect(prev).toHaveLength(1);
    expect(next).not.toBe(prev);
  });
  it('a reakciók legfeljebb 24 korábbit tartanak meg + az újat (25)', () => {
    let list: { id: string; emoji: string; x: number }[] = [];
    for (let i = 0; i < 40; i++) list = appendLiveFloat(list, { id: `f${i}`, emoji: '🔥', x: i });
    expect(list).toHaveLength(25);
    expect(list[0].id).toBe('f15');
    expect(list[24]).toEqual({ id: 'f39', emoji: '🔥', x: 39 });
  });
});

describe('flipFacing', () => {
  it('elöl ↔ hátul', () => {
    expect(flipFacing('front')).toBe('back');
    expect(flipFacing('back')).toBe('front');
  });
});

describe('quickGridSources', () => {
  let n = 0;
  const gen = () => `q${++n}`;
  it('az aktív jelenet forrásai, rendezve (a rejtett is benne marad)', () => {
    let doc = createLiveDoc('Show', gen);
    const sid = doc.scenes[0].id;
    doc = addSource(doc, sid, 'text', gen, { label: 'Title' });
    const textId = doc.scenes[0].sources[1].id;
    doc = toggleSourceVisible(doc, sid, textId);
    const out = quickGridSources(doc);
    expect(out.map((s) => s.kind)).toEqual(['camera', 'text']);
    expect(out[1].visible).toBe(false);
  });
  it('jelenetváltás után az új aktív jelenet forrásai', () => {
    let doc = createLiveDoc('Show', gen);
    doc = addScene(doc, 'Second', gen);
    doc = setActiveScene(doc, doc.scenes[1].id);
    expect(quickGridSources(doc)).toEqual(doc.scenes[1].sources);
  });
  it('ismeretlen aktív jelenet → az első jelenet forrásai (az activeScene tartaléka)', () => {
    const base = createLiveDoc('Show', gen);
    const doc = { ...base, activeSceneId: 'missing' };
    expect(quickGridSources(doc)).toEqual(base.scenes[0].sources);
  });
  it('nincs jelenet → üres lista', () => {
    const doc = { ...createLiveDoc('Show', gen), scenes: [] };
    expect(quickGridSources(doc)).toEqual([]);
  });
});

describe('showsEndedView', () => {
  const err = (error: LiveState['error']): LiveState => ({ ...initialLiveState(0), phase: 'error', error });
  it('nem létező adás → mindenkinek a „véget ért" nézet', () => {
    expect(showsEndedView(true, true, initialLiveState(0))).toBe(true);
    expect(showsEndedView(true, false, initialLiveState(0))).toBe(true);
  });
  it('néző: befejezett / nem létező adás hibája → „véget ért"', () => {
    expect(showsEndedView(false, false, err('ended'))).toBe(true);
    expect(showsEndedView(false, false, err('notFound'))).toBe(true);
  });
  it('néző: más hiba (engedély, token, időkorlát) → hiba-sáv, nem „véget ért"', () => {
    expect(showsEndedView(false, false, err('permission'))).toBe(false);
    expect(showsEndedView(false, false, err('reconnectTimeout'))).toBe(false);
  });
  it('host: a befejezett hiba sem vált „véget ért" nézetre (a hiba-sáv marad)', () => {
    expect(showsEndedView(false, true, err('ended'))).toBe(false);
  });
});
