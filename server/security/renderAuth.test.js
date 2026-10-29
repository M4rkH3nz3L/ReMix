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

  it('tulajdonos nélküli job → prod-ban elzárva, insecure-dev-ben elérhető (B26)', () => {
    // B26: prod-ban a tulajdonos nélküli job ELZÁRVA; csak insecure-dev-ben elérhető
    expect(canAccessRenderJob(null, 'u1')).toBe(false);
    expect(canAccessRenderJob(undefined, null)).toBe(false);
    expect(canAccessRenderJob('', 'u1')).toBe(false);
    expect(canAccessRenderJob(null, 'u1', true)).toBe(true);
    expect(canAccessRenderJob(undefined, null, true)).toBe(true);
  });
});
