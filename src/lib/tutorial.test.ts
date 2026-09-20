import {
  TUTORIAL_LESSONS,
  getLesson,
  nextStepIndex,
  prevStepIndex,
  stepI18nKeys,
} from '@/lib/tutorial';

describe('tutorial adat-integritás', () => {
  it('minden leckének egyedi id-je van és van legalább egy lépése', () => {
    const ids = TUTORIAL_LESSONS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of TUTORIAL_LESSONS) {
      expect(l.steps.length).toBeGreaterThan(0);
    }
  });
  it('a lépés-kulcsok leckén belül egyediek', () => {
    for (const l of TUTORIAL_LESSONS) {
      const keys = l.steps.map((s) => s.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
  it('getLesson megtalálja / hiányra undefined', () => {
    expect(getLesson('basics')?.id).toBe('basics');
    expect(getLesson('nincs-ilyen')).toBeUndefined();
  });
});

describe('léptetés', () => {
  it('nextStepIndex a végén -1 (kész)', () => {
    expect(nextStepIndex(0, 3)).toBe(1);
    expect(nextStepIndex(1, 3)).toBe(2);
    expect(nextStepIndex(2, 3)).toBe(-1);
  });
  it('prevStepIndex 0 alá nem megy', () => {
    expect(prevStepIndex(2)).toBe(1);
    expect(prevStepIndex(0)).toBe(0);
  });
});

describe('stepI18nKeys', () => {
  it('a helyes al-kulcsokat építi', () => {
    expect(stepI18nKeys('basics', { key: 's1' })).toEqual({
      action: 'tutorial.lessons.basics.s1_action',
      where: 'tutorial.lessons.basics.s1_where',
      result: 'tutorial.lessons.basics.s1_result',
    });
  });
});
