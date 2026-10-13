import { canCollaborate, canManageCompany, collabCan } from './collabAccess';
import { TIER_ORDER, type Tier } from './tiers';

describe('collabAccess — tier-gate + szerep-jogok (TECH-TOP §4)', () => {
  test('canCollaborate: free NEM, Amatőr+ IGEN', () => {
    expect(canCollaborate('free')).toBe(false);
    for (const t of ['basic', 'pro', 'ultra', 'business'] as Tier[]) {
      expect(canCollaborate(t)).toBe(true);
    }
  });

  test('canManageCompany: CSAK a Céges (business)', () => {
    for (const t of ['free', 'basic', 'pro', 'ultra'] as Tier[]) {
      expect(canManageCompany(t)).toBe(false);
    }
    expect(canManageCompany('business')).toBe(true);
  });

  test('owner = Admin → MINDEN jog', () => {
    for (const a of ['view', 'edit', 'invite', 'manage', 'delete'] as const) {
      expect(collabCan('owner', a)).toBe(true);
    }
  });

  test('editor = néz + szerkeszt, de nem invite/manage/delete', () => {
    expect(collabCan('editor', 'view')).toBe(true);
    expect(collabCan('editor', 'edit')).toBe(true);
    expect(collabCan('editor', 'invite')).toBe(false);
    expect(collabCan('editor', 'manage')).toBe(false);
    expect(collabCan('editor', 'delete')).toBe(false);
  });

  test('viewer = csak néz', () => {
    expect(collabCan('viewer', 'view')).toBe(true);
    for (const a of ['edit', 'invite', 'manage', 'delete'] as const) {
      expect(collabCan('viewer', a)).toBe(false);
    }
  });

  test('a gate monoton a rang mentén (aki magasabb, az is collabolhat)', () => {
    let seenTrue = false;
    for (const t of TIER_ORDER) {
      if (canCollaborate(t)) seenTrue = true;
      // ha egyszer igaz lett, feljebb is igaz marad
      if (seenTrue) expect(canCollaborate(t)).toBe(true);
    }
  });
});
