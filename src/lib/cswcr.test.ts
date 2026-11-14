import { chainProjectOf, chains, flowStats, linkRatio, recordEvent, type CswcrEvent } from '@/lib/cswcr';

/** 📊 F1 / C5: CSWCR a telefonon, a hivatkozás-láncokból és a helyi eseménynaplóból (ReMix.md 7.2). */
const ev = (at: string, type: CswcrEvent['type'], projectId: string, kind: CswcrEvent['kind'], extra: Partial<CswcrEvent> = {}): CswcrEvent => ({
  at: `2026-11-14T0${at}:00Z`,
  type,
  projectId,
  kind,
  ...extra,
});

describe('📊 CSWCR mag', () => {
  it('a napló felső korlátos, a legrégebbit hagyja el', () => {
    let log: CswcrEvent[] = [];
    for (let i = 0; i < 7; i++) log = recordEvent(log, ev(`${i}:0`, 'edit', `p${i}`, 'audio'), 5);
    expect(log.map((e) => e.projectId)).toEqual(['p2', 'p3', 'p4', 'p5', 'p6']);
  });

  it('link-arány: a hivatkozásos átadások aránya; átadás nélkül null', () => {
    expect(linkRatio([])).toEqual({ link: 0, copy: 0, ratio: null });
    const log = [ev('1:0', 'handoff', 'a', 'audio', { via: 'link', toProjectId: 'v' }), ev('1:1', 'handoff', 'a', 'audio', { via: 'copy', toProjectId: 'v2' }), ev('1:2', 'handoff', 'a', 'audio', { via: 'link', toProjectId: 'v3' }), ev('1:3', 'export', 'v', 'video')];
    expect(linkRatio(log)).toEqual({ link: 2, copy: 1, ratio: 2 / 3 });
  });

  it('láncok: a hivatkozás-élek összefüggő komponensei, determinisztikus sorrendben; a hiányzó forrás is a lánc része', () => {
    const out = chains([
      { id: 'video1', kind: 'video', links: ['audio1'] },
      { id: 'audio1', kind: 'audio', links: [] },
      { id: 'image1', kind: 'image', links: [] },
      { id: 'video2', kind: 'video', links: ['audio1'] },
      { id: 'remix1', kind: 'video', links: ['eltűnt'] },
    ]);
    expect(out).toEqual([['audio1', 'video1', 'video2'], ['eltűnt', 'remix1'], ['image1']]);
  });

  it('CSWCR: a zenész-lánc elkezdett (2. stúdió) és befejezett (export); egystúdiós lánc nem számít; külső kimenet a lánc közepén megszakít', () => {
    const projects = [
      chainProjectOf({ id: 'audio1', kind: 'audio', assets: [] }),
      chainProjectOf({ id: 'video1', kind: 'video', assets: [{ source: { projectId: 'audio1' } }] }),
      chainProjectOf({ id: 'solo', kind: 'image', assets: [] }),
      chainProjectOf({ id: 'audio2', kind: 'audio', assets: [] }),
      chainProjectOf({ id: 'video2', kind: 'video', assets: [{ source: { projectId: 'audio2' } }] }),
      chainProjectOf({ id: 'audio3', kind: 'audio', assets: [] }),
      chainProjectOf({ id: 'video3', kind: 'video', remixOf: { projectId: 'audio3' } }),
    ];
    const log = [
      // zenész-lánc: hang → videó (link) → export
      ev('1:0', 'edit', 'audio1', 'audio'),
      ev('1:1', 'handoff', 'audio1', 'audio', { via: 'link', toProjectId: 'video1' }),
      ev('1:2', 'edit', 'video1', 'video'),
      ev('1:3', 'relink', 'video1', 'video'),
      ev('1:4', 'export', 'video1', 'video'),
      // egystúdiós: exportált, de nem többstúdiós
      ev('2:0', 'edit', 'solo', 'image'),
      ev('2:1', 'export', 'solo', 'image'),
      // elkezdett, de nem befejezett
      ev('3:0', 'edit', 'audio2', 'audio'),
      ev('3:1', 'edit', 'video2', 'video'),
      // elkezdett, befejezett, DE kész kimenet jött kívülről a lánc közepén
      ev('4:0', 'edit', 'audio3', 'audio'),
      ev('4:1', 'edit', 'video3', 'video'),
      ev('4:2', 'import', 'video3', 'video', { external: true }),
      ev('4:3', 'post', 'video3', 'video'),
    ];
    const s = flowStats(projects, log);
    expect(s).toEqual({ chains: 4, multiStudio: 3, started: 3, completed: 1, cswcr: 1 / 3, relinks: 1 });
    // nyersanyag-import nem szakít meg
    const raw = log.map((e) => (e.projectId === 'video3' && e.type === 'import' ? { ...e, external: false } : e));
    expect(flowStats(projects, raw).completed).toBe(2);
    // export az elkezdés ELŐTT nem befejezés
    const early = [ev('5:0', 'edit', 'audio2', 'audio'), ev('5:1', 'export', 'audio2', 'audio'), ev('5:2', 'edit', 'video2', 'video')];
    expect(flowStats(projects, early)).toMatchObject({ started: 1, completed: 0, cswcr: 0 });
    expect(flowStats([], [])).toEqual({ chains: 0, multiStudio: 0, started: 0, completed: 0, cswcr: null, relinks: 0 });
  });

  it('chainProjectOf: a linked asset forrásai és a remix-eredet, rendezve, duplikátum nélkül', () => {
    expect(chainProjectOf({ id: 'v', kind: 'video', assets: [{ source: { projectId: 'b' } }, { source: { projectId: 'a' } }, {}], remixOf: { projectId: 'b' } })).toEqual({ id: 'v', kind: 'video', links: ['a', 'b'] });
    expect(chainProjectOf({ id: 'x' })).toEqual({ id: 'x', kind: 'video', links: [] });
  });
});
