import { capabilityRequiresPro } from '@/lib/capabilities';
import {
  GEN_MEDIA_KINDS,
  buildGenPlan,
  genCapability,
  genRequiresPro,
  validateGenRequest,
  type GenRequest,
} from '@/lib/genMedia';

describe('genMedia — katalógus + capability', () => {
  it('minden kind cloud+Pro capability-hez kötött', () => {
    for (const kind of GEN_MEDIA_KINDS) {
      expect(genRequiresPro(kind)).toBe(true);
      expect(capabilityRequiresPro(genCapability(kind))).toBe(true);
    }
  });
  it('a kép-műveletek a genImage capabilityre képződnek', () => {
    expect(genCapability('image')).toBe('genImage');
    expect(genCapability('inpaint')).toBe('genImage');
    expect(genCapability('outpaint')).toBe('genImage');
    expect(genCapability('video')).toBe('genVideo');
    expect(genCapability('voiceClone')).toBe('voiceClone');
  });
});

describe('genMedia — validáció', () => {
  it('text→kép: prompt kell', () => {
    expect(validateGenRequest({ kind: 'image' }).errors[0].code).toBe('missing_prompt');
    expect(validateGenRequest({ kind: 'image', prompt: 'egy macska' }).ok).toBe(true);
  });

  it('inpaint: forrás + maszk + prompt kell', () => {
    const errs = validateGenRequest({ kind: 'inpaint', prompt: 'x' }).errors.map((e) => e.code);
    expect(errs).toEqual(expect.arrayContaining(['missing_source', 'missing_mask']));
    expect(validateGenRequest({ kind: 'inpaint', prompt: 'x', sourceUri: 's', maskUri: 'm' }).ok).toBe(true);
  });

  it('voice-clone: referencia + KÖTELEZŐ hozzájárulás', () => {
    const errs = validateGenRequest({ kind: 'voiceClone', prompt: 'szöveg', refUri: 'r' }).errors.map((e) => e.code);
    expect(errs).toContain('missing_consent');
    expect(validateGenRequest({ kind: 'voiceClone', prompt: 'szöveg', refUri: 'r', consent: true }).ok).toBe(true);
  });

  it('videó időtartam-korlát (1–60 mp)', () => {
    expect(validateGenRequest({ kind: 'video', prompt: 'x', durationSec: 120 }).errors[0].code).toBe('duration_out_of_range');
    expect(validateGenRequest({ kind: 'video', prompt: 'x', durationSec: 10 }).ok).toBe(true);
  });
});

describe('genMedia — buildGenPlan', () => {
  it('deklaratív job-terv a worker-adapterhez', () => {
    const req: GenRequest = { kind: 'video', prompt: '  naplemente  ', durationSec: 8, params: { seed: 42 } };
    const plan = buildGenPlan(req);
    expect(plan).toMatchObject({ kind: 'video', capability: 'genVideo', prompt: 'naplemente', durationSec: 8 });
    expect(plan.params).toEqual({ seed: 42 });
  });
  it('a hiányzó opcionális mezők nem kerülnek a tervbe', () => {
    const plan = buildGenPlan({ kind: 'image', prompt: 'x' });
    expect(plan.sourceUri).toBeUndefined();
    expect(plan.params).toEqual({});
  });
});
