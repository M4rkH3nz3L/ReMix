import { rebaseDocumentUris } from '@/lib/docUri';

const OLD = 'file:///var/mobile/Containers/Data/Application/08FAC1C2-D416-4383-950D-0BE416DA456F/Documents/';
const NEW = 'file:///var/mobile/Containers/Data/Application/11111111-2222-3333-4444-555555555555/Documents/';

describe('rebaseDocumentUris', () => {
  it('a régi konténer Documents-előtagját az aktuálisra cseréli (minden előfordulást)', () => {
    const raw = JSON.stringify({
      assets: [{ uri: `${OLD}Files/Projektek/bogre/m3d_a.usdz` }],
      model3d: { poster: `${OLD}Files/Projektek/bogre/m3d_a_poster.png` },
    });
    const out = rebaseDocumentUris(raw, NEW);
    expect(out).not.toContain('08FAC1C2');
    expect(JSON.parse(out).assets[0].uri).toBe(`${NEW}Files/Projektek/bogre/m3d_a.usdz`);
    expect(JSON.parse(out).model3d.poster).toBe(`${NEW}Files/Projektek/bogre/m3d_a_poster.png`);
  });

  it('változatlan konténernél no-op', () => {
    const raw = JSON.stringify({ uri: `${NEW}media/x.mp4` });
    expect(rebaseDocumentUris(raw, NEW)).toBe(raw);
  });

  it('a perjel nélküli cél-uri-t is kezeli', () => {
    const raw = JSON.stringify({ uri: `${OLD}media/x.mp4` });
    expect(JSON.parse(rebaseDocumentUris(raw, NEW.slice(0, -1))).uri).toBe(`${NEW}media/x.mp4`);
  });

  it('a /private/var és a szimulátor-útvonalat is felismeri', () => {
    const sim =
      'file:///Users/u/Library/Developer/CoreSimulator/Devices/AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA/data/Containers/Data/Application/BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB/Documents/';
    const priv = OLD.replace('file:///var', 'file:///private/var');
    const raw = JSON.stringify([`${sim}a.png`, `${priv}b.png`]);
    expect(JSON.parse(rebaseDocumentUris(raw, NEW))).toEqual([`${NEW}a.png`, `${NEW}b.png`]);
  });

  it('nem-iOS cél (Android) vagy http uri esetén nem nyúl semmihez', () => {
    const raw = JSON.stringify({ a: `${OLD}x.png`, b: 'https://cdn.example.com/x.png' });
    expect(rebaseDocumentUris(raw, 'file:///data/user/0/com.h3nz3l.remix/files/')).toBe(raw);
    const httpOnly = JSON.stringify({ b: 'https://cdn.example.com/x.png' });
    expect(rebaseDocumentUris(httpOnly, NEW)).toBe(httpOnly);
  });
});
