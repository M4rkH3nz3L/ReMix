import { rangeSuffix, stemSpecs } from '@/lib/audioStems';
import { createEmptyProject } from '@/lib/projectUtils';
import type { AudioClip } from '@/types/project';

const c = { kind: 'audio', id: 'a', uri: 'u', label: 'a', start: 0, duration: 1, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' } as AudioClip;

describe('🎚️ stem-lista', () => {
  it('csak a klipet tartalmazó hangsávok, sorszámmal, biztonságos és egyedi névvel', () => {
    const p = createEmptyProject('x', '9:16', undefined, 'audio');
    const mix = { tracks: p.tracks.map((t) => (t.type === 'music' || t.type === 'sfx' || t.type === 'voiceover' ? { ...t, clips: [c] } : t)) };
    const names: Record<string, string> = { music: 'Zene/Alap', voiceover: 'Beszéd', sfx: 'Beszéd' };
    const specs = stemSpecs(mix, (t) => names[t]);
    expect(specs.map((s) => s.track).sort()).toEqual(['music', 'sfx', 'voiceover']);
    expect(specs.map((s) => s.name)).toContain('01 Zene_Alap');
    expect(new Set(specs.map((s) => s.name.replace(/^\d+ /, ''))).size).toBeLessThanOrEqual(2);
    expect(new Set(specs.map((s) => s.name)).size).toBe(3);
  });
  it('a tartomány utótag', () => {
    expect(rangeSuffix(12.4, 90)).toBe('_0m12s-1m30s');
  });
});
