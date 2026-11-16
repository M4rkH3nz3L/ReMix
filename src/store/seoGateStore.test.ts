import { seoComplete, useSeoGate } from '@/store/seoGateStore';
import type { Project } from '@/types/project';

const project = (seo?: Project['seo']) => ({ id: 'p', name: 'P', seo }) as unknown as Project;

describe('📣 S22: SEO-kapu a megosztás előtt', () => {
  it('teljes SEO-val azonnal továbbenged, lap nélkül', async () => {
    const p = project({ title: 'P', description: 'd', hashtags: ['a'], keywords: ['k'] });
    expect(seoComplete(p)).toBe(true);
    await expect(useSeoGate.getState().ensureSeo(p)).resolves.toBe(p);
    expect(useSeoGate.getState().request).toBeNull();
  });

  it('hiányos SEO-nál a lap nyílik; a kitöltött projekttel vagy megszakításkor null-lal tér vissza', async () => {
    const p = project({ title: 'P', description: '', hashtags: [], keywords: [] });
    const pending = useSeoGate.getState().ensureSeo(p);
    expect(useSeoGate.getState().request?.project).toBe(p);
    const filled = { ...p, seo: { title: 'P', description: 'd', hashtags: ['a'], keywords: ['k'] } };
    useSeoGate.getState().finish(filled);
    await expect(pending).resolves.toBe(filled);
    const cancelled = useSeoGate.getState().ensureSeo(project());
    useSeoGate.getState().finish(null);
    await expect(cancelled).resolves.toBeNull();
  });

  it('egy új kérés a nyitva hagyott előzőt megszakítja', async () => {
    const first = useSeoGate.getState().ensureSeo(project());
    const second = useSeoGate.getState().ensureSeo(project());
    await expect(first).resolves.toBeNull();
    useSeoGate.getState().finish(null);
    await expect(second).resolves.toBeNull();
  });
});
