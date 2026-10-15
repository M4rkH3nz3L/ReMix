import { planBatchExport } from '@/lib/batchExport';
import type { RenderSettings } from '@/lib/render';

const base: RenderSettings = { resolution: 1080, fps: 30, quality: 'medium' };

describe('batchExport — platform → deduplikált render-job-terv', () => {
  it('üres kiválasztás → üres terv', () => {
    expect(planBatchExport([], base)).toEqual([]);
  });

  it('a 9:16-os platformok (TikTok/Reels/Shorts) EGY jobba vonódnak (azonos kimenet)', () => {
    const jobs = planBatchExport(['tiktok', 'reels', 'shorts'], base);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].platforms).toEqual(['tiktok', 'reels', 'shorts']);
    expect(jobs[0].aspect).toBe('9:16');
    expect(jobs[0].label).toBe('TikTok · Reels · Shorts');
  });

  it('eltérő arányok KÜLÖN jobot adnak (9:16 vs 16:9 vs 4:5)', () => {
    const jobs = planBatchExport(['tiktok', 'youtube', 'instagram'], base);
    expect(jobs).toHaveLength(3);
    expect(jobs.map((j) => j.aspect)).toEqual(['9:16', '16:9', '4:5']);
  });

  it('a preset settings a base fölé merge-elődik (a preset nyer), de a base egyéb mezői megmaradnak', () => {
    const jobs = planBatchExport(['youtube'], { resolution: 720, fps: 24, quality: 'low' });
    expect(jobs[0].settings.resolution).toBe(1080); // a preset felülírja
    expect(jobs[0].settings.quality).toBe('high'); // a preset
    expect(jobs[0].settings.fps).toBe(30); // a preset
    expect(jobs[0].settings.bitrateMbps).toBe(12); // a presetből
  });
});
