const { canAccessRenderJob } = require('./renderAuth');

describe('renderAuth — canAccessRenderJob (BOLA)', () => {
  it('a tulajdonos hozzáfér a saját jobjához', () => {
    expect(canAccessRenderJob('u1', 'u1')).toBe(true);
  });

  it('⚠️ IDEGEN hívó NEM fér hozzá más jobjához', () => {
    expect(canAccessRenderJob('u1', 'u2')).toBe(false);
  });

  it('token nélküli hívó (callerId null) NEM fér hozzá tulajdonolt jobhoz', () => {
    expect(canAccessRenderJob('u1', null)).toBe(false);
    expect(canAccessRenderJob('u1', undefined)).toBe(false);
    expect(canAccessRenderJob('u1', '')).toBe(false);
  });

  it('tulajdonos nélküli job (dev/legacy) → nem korlátozott', () => {
    expect(canAccessRenderJob(null, 'u1')).toBe(true);
    expect(canAccessRenderJob(undefined, null)).toBe(true);
    expect(canAccessRenderJob('', 'u1')).toBe(true);
  });
});
