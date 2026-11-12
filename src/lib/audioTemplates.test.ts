import { applyAudioTemplate, AUDIO_TEMPLATES, templateTarget } from '@/lib/audioTemplates';
import { createEmptyProject } from '@/lib/projectUtils';

/** 🧩 AP7: a hang-projekt sablonjai. */
const names = { voice: 'Beszéd', music: 'Zene', sfx: 'Hangok', sections: ['Intro', 'Verze', 'Refrén', 'Outro'] as [string, string, string, string] };
describe('🧩 hang-sablonok', () => {
  const base = createEmptyProject('x', '9:16', undefined, 'audio');
  it('az üres sablon nem változtat', () => {
    expect(applyAudioTemplate(base, 'blank', names)).toBe(base);
    expect(AUDIO_TEMPLATES).toEqual(['blank', 'podcast', 'music', 'voiceover']);
  });
  it('podcast: sáv-nevek, podcast-hangosság, a beszéd a halkítás kulcsa', () => {
    const p = applyAudioTemplate(base, 'podcast', names);
    expect(p.tracks.find((t) => t.type === 'voiceover')?.name).toBe('Beszéd');
    expect(p.audioMaster?.target).toBe('podcast');
    expect(p.audioMaster?.duckTrigger).toBe('voiceover');
    expect(templateTarget('podcast')).toBe('podcast');
  });
  it('zene: 120 BPM 4/4, szerkezeti jelölők az ütem-határokon, zenei hangosság', () => {
    const p = applyAudioTemplate(base, 'music', names);
    expect(p.bpm).toBe(120);
    expect(p.timeSignature).toEqual({ beatsPerBar: 4, beatUnit: 4 });
    expect(p.markers?.map((m) => [m.time, m.label])).toEqual([[0, 'Intro'], [8, 'Verze'], [24, 'Refrén'], [40, 'Outro']]);
    expect(p.audioMaster?.target).toBe('music');
  });
  it('hangalámondás: videós hangosság, a beszéd-sáv neve', () => {
    const p = applyAudioTemplate(base, 'voiceover', names);
    expect(p.audioMaster?.target).toBe('video');
    expect(p.tracks.find((t) => t.type === 'voiceover')?.name).toBe('Beszéd');
    expect(templateTarget('blank')).toBeNull();
  });
});
