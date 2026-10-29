import { exportLint, TEMPLATE_PLACEHOLDER_KEYS } from '@/lib/exportLint';
import { createEmptyProject } from '@/lib/projectUtils';
import type { Clip, Project } from '@/types/project';

/** projekt a megadott klipekkel (a fajta szerinti sávra) */
function withClips(clips: Partial<Clip>[]): Project {
  const p = createEmptyProject('Hook + CTA', '9:16');
  return {
    ...p,
    tracks: p.tracks.map((t) => ({
      ...t,
      clips: clips
        .filter((c) => (c.kind === 'text' ? t.type === 'text' : c.kind === 'audio' ? t.type === 'music' : t.type === 'video'))
        .map((c) => c as Clip),
    })),
  };
}

const video = (id: string, volume = 1, uri = `file:///v/${id}.mp4`) =>
  ({ id, kind: 'video', start: 0, duration: 5, uri, trimIn: 0, sourceDuration: 5, speed: 1, volume }) as Partial<Clip>;
const text = (id: string, value: string, start = 1) => ({ id, kind: 'text', start, duration: 2, text: value }) as Partial<Clip>;

describe('exportLint', () => {
  it('üres projekt → egyetlen „empty"', () => {
    expect(exportLint(createEmptyProject('x', '9:16'))).toEqual([{ code: 'empty' }]);
  });

  it('a sablon helyőrző szövege (kis/nagybetű, szóköz mindegy) + üres szövegklip', () => {
    const p = withClips([video('v1'), text('t1', '  írd IDE a   lényeget…'), text('t2', '   '), text('t3', 'Saját mondat')]);
    const issues = exportLint(p, { placeholders: ['Írd ide a lényeget…'] });
    expect(issues).toEqual([
      { code: 'placeholderText', clipId: 't1', start: 1, detail: 'írd IDE a   lényeget…' },
      { code: 'emptyText', clipId: 't2', start: 1 },
    ]);
  });

  it('hiányzó média klipenként egyszer (ugyanaz az uri többször)', () => {
    const p = withClips([video('v1', 1, 'file:///gone.mp4'), { ...video('v2', 1, 'file:///gone.mp4'), start: 5 }]);
    const issues = exportLint(p, { missingUris: ['file:///gone.mp4'] });
    expect(issues.filter((i) => i.code === 'missingMedia')).toEqual([
      { code: 'missingMedia', clipId: 'v1', start: 0, detail: 'gone.mp4' },
    ]);
  });

  it('minden hang némítva → „silent"; ha van hallható klip, nincs', () => {
    expect(exportLint(withClips([video('v1', 0)])).map((i) => i.code)).toEqual(['silent']);
    expect(exportLint(withClips([video('v1', 0.5)]))).toEqual([]);
  });

  it('a helyőrző-kulcsok a templates.* alatt vannak (a „Hook + CTA" sorát is lefedi)', () => {
    expect(TEMPLATE_PLACEHOLDER_KEYS).toContain('templates.hook-cta.line1');
    expect(TEMPLATE_PLACEHOLDER_KEYS.every((k) => k.startsWith('templates.'))).toBe(true);
  });
});
