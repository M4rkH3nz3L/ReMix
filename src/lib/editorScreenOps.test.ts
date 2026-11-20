import type { Project } from '@/types/project';

import {
  AUTOSAVE_MS,
  autosaveDelay,
  collabScreenPath,
  editorLayoutKind,
  isDeepLinkPanel,
  nextAspectRatio,
  videoClipUris,
} from '@/lib/editorScreenOps';

describe('autosave-időzítés (kirögzítve)', () => {
  it('az alap késleltetés 800 ms', () => {
    expect(AUTOSAVE_MS).toBe(800);
    expect(autosaveDelay(0)).toBe(800);
  });

  it('bukás után exponenciálisan nő: 1,6 s → 3,2 s → 6,4 s', () => {
    expect([1, 2, 3].map(autosaveDelay)).toEqual([1600, 3200, 6400]);
  });

  it('a felső korlát 10 s', () => {
    expect(autosaveDelay(4)).toBe(10_000);
    expect(autosaveDelay(50)).toBe(10_000);
  });
});

describe('mély-link panelek', () => {
  it('a kijelölés nélkül nyitható panelek engedettek', () => {
    for (const p of ['assistant', 'export', 'captions', 'audio', 'library', 'transcript', 'sticker', 'imagedoc']) {
      expect(isDeepLinkPanel(p)).toBe(true);
    }
  });

  it('a kijelölést igénylő vagy ismeretlen panel nem nyílik paramból', () => {
    for (const p of ['clip', 'text', 'keyframes', '', 'ASSISTANT', 'unknown']) {
      expect(isDeepLinkPanel(p)).toBe(false);
    }
  });
});

describe('képarány-léptetés', () => {
  const ids = ['9:16', '16:9', '1:1'];

  it('a következőre lép, a végéről körbe az elsőre', () => {
    expect(nextAspectRatio(ids, '9:16')).toBe('16:9');
    expect(nextAspectRatio(ids, '16:9')).toBe('1:1');
    expect(nextAspectRatio(ids, '1:1')).toBe('9:16');
  });

  it('ismeretlen jelenlegi → az első', () => {
    expect(nextAspectRatio(ids, '4:5')).toBe('9:16');
  });
});

describe('proxy-előmelegítés URI-listája', () => {
  it('csak a videósávok videó-klipjei, sorrendben', () => {
    const project = {
      tracks: [
        { type: 'video', clips: [{ kind: 'video', uri: 'a.mp4' }, { kind: 'image', uri: 'b.jpg' }, { kind: 'video', uri: 'c.mp4' }] },
        { type: 'pip', clips: [{ kind: 'video', uri: 'pip.mp4' }] },
        { type: 'music', clips: [{ kind: 'audio', uri: 'm.mp3' }] },
        { type: 'video', clips: [{ kind: 'video', uri: 'd.mp4' }] },
      ],
    } as unknown as Project;
    expect(videoClipUris(project)).toEqual(['a.mp4', 'c.mp4', 'd.mp4']);
  });

  it('üres projekt → üres lista', () => {
    expect(videoClipUris({ tracks: [] } as unknown as Project)).toEqual([]);
  });
});

describe('közreműködők útvonala', () => {
  it('megosztott projektnél a tulajjal', () => {
    expect(collabScreenPath('p1', { ownerId: 'u9' })).toBe('/collab/p1?owner=u9');
  });

  it('nem megosztottnál csak a projekt', () => {
    expect(collabScreenPath('p1', null)).toBe('/collab/p1');
  });
});

describe('elrendezés méret-osztály szerint', () => {
  it('expanded mindig nyer (fekvőben is)', () => {
    expect(editorLayoutKind({ isExpanded: true, sizeClass: 'expanded', isLandscape: true })).toBe('expanded');
    expect(editorLayoutKind({ isExpanded: true, sizeClass: 'medium', isLandscape: false })).toBe('expanded');
  });

  it('medium: fekvőben oldalsáv, állóban függőleges rakás dokkal', () => {
    expect(editorLayoutKind({ isExpanded: false, sizeClass: 'medium', isLandscape: true })).toBe('mediumLandscape');
    expect(editorLayoutKind({ isExpanded: false, sizeClass: 'medium', isLandscape: false })).toBe('medium');
  });

  it('compact: fekvőben is a függőleges rakás', () => {
    expect(editorLayoutKind({ isExpanded: false, sizeClass: 'compact', isLandscape: false })).toBe('stacked');
    expect(editorLayoutKind({ isExpanded: false, sizeClass: 'compact', isLandscape: true })).toBe('stacked');
  });
});
