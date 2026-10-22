import {
  evaluateExamResponse,
  examAllowsTask,
  examFixtureProject,
  examRequestForTask,
  providerFingerprint,
} from '@/lib/aiExam';
import { AI_TASKS } from '@/lib/aiProviders';

/**
 * 🧪 Feladat-vizsga (local-ai 5.3): séma-bukás → a feladat NEM validálódik;
 * ujjlenyomat-váltás → az eredmény érvénytelen; az assistant-vizsga a VALÓDI
 * validateAiCommand határon megy át.
 */

const fixture = examFixtureProject();

describe('aiExam — golden kérések', () => {
  it('mind a 6 feladatra van determinista kérés', () => {
    for (const task of AI_TASKS) {
      const req = examRequestForTask(task, fixture);
      expect(req.path.startsWith('/ai/')).toBe(true);
      expect(req.body).toBeTruthy();
      // determinista: két hívás ugyanazt adja
      expect(examRequestForTask(task, fixture)).toEqual(req);
    }
  });

  it('a Pro-kapus végpontok jelölve vannak (free tieren blocked, nem fail)', () => {
    expect(examRequestForTask('autoEdit', fixture).proOnly).toBe(true);
    expect(examRequestForTask('storyStructure', fixture).proOnly).toBe(true);
    expect(examRequestForTask('assistant', fixture).proOnly).toBe(false);
  });
});

describe('aiExam — assistant a validateAiCommand határon', () => {
  it('érvényes SPLIT a fixture-klipre → PASS', () => {
    const verdict = evaluateExamResponse(
      'assistant',
      { message: 'ok', commands: [{ type: 'SPLIT_CLIP', clipId: 'clip_exam_video', time: 4 }] },
      fixture,
    );
    expect(verdict.ok).toBe(true);
  });

  it('hallucinált clipId → FAIL (a határ fogja meg, nem a séma)', () => {
    const verdict = evaluateExamResponse(
      'assistant',
      { message: 'ok', commands: [{ type: 'SPLIT_CLIP', clipId: 'clip_nincs', time: 4 }] },
      fixture,
    );
    expect(verdict.ok).toBe(false);
  });

  it('privilegizált/ismeretlen parancstípus → FAIL', () => {
    const verdict = evaluateExamResponse(
      'assistant',
      { message: 'ok', commands: [{ type: 'DELETE_PROJECT' }] },
      fixture,
    );
    expect(verdict.ok).toBe(false);
  });

  it('üres commands → FAIL', () => {
    expect(evaluateExamResponse('assistant', { commands: [] }, fixture).ok).toBe(false);
  });
});

describe('aiExam — séma-értékelés a többi feladatra', () => {
  it('hooks: 3+ használható szöveg kell', () => {
    const three = { hooks: [{ text: 'a' }, { text: 'b' }, { text: 'c' }] };
    expect(evaluateExamResponse('hooks', three, fixture).ok).toBe(true);
    const two = { hooks: [{ text: 'a' }, { text: 'b' }, { text: '  ' }] };
    expect(evaluateExamResponse('hooks', two, fixture).ok).toBe(false);
  });

  it('captionStudio: a golden szegmens-id-re illő javaslat kell', () => {
    const good = { segments: [{ id: 'seg_1', emphasis: [0, 2], emoji: '🎸' }] };
    expect(evaluateExamResponse('captionStudio', good, fixture).ok).toBe(true);
    const wrongId = { segments: [{ id: 'mas_id', emphasis: [0], emoji: '' }] };
    expect(evaluateExamResponse('captionStudio', wrongId, fixture).ok).toBe(false);
    const badShape = { segments: [{ id: 'seg_1', emphasis: ['x'], emoji: '' }] };
    expect(evaluateExamResponse('captionStudio', badShape, fixture).ok).toBe(false);
  });

  it('autoEdit: legalább egy érvényes keep-listás változat', () => {
    const good = { variants: [{ id: 'fast', keep: [{ start: 0, end: 3 }] }] };
    expect(evaluateExamResponse('autoEdit', good, fixture).ok).toBe(true);
    const bad = { variants: [{ id: 'fast', keep: [{ start: 5, end: 2 }] }] };
    expect(evaluateExamResponse('autoEdit', bad, fixture).ok).toBe(false);
  });

  it('storyStructure: legalább 2 érvényes fejezet-kezdet', () => {
    const good = { chapters: [{ start: 0, kind: 'hook' }, { start: 12, kind: 'value' }] };
    expect(evaluateExamResponse('storyStructure', good, fixture).ok).toBe(true);
    expect(evaluateExamResponse('storyStructure', { chapters: [{ start: 0 }] }, fixture).ok).toBe(
      false,
    );
  });

  it('thumbHeadlines: legalább egy nem-üres cím', () => {
    expect(evaluateExamResponse('thumbHeadlines', { headlines: ['Cím'] }, fixture).ok).toBe(true);
    expect(evaluateExamResponse('thumbHeadlines', { headlines: ['  '] }, fixture).ok).toBe(false);
  });

  it('nem-objektum válasz → FAIL, értelmes indokkal', () => {
    const v = evaluateExamResponse('hooks', 'nem json', fixture);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason.length).toBeGreaterThan(0);
    }
  });
});

describe('aiExam — ujjlenyomat + engedély-kapu', () => {
  const base = { provider: 'openai' as const, baseUrl: '', model: 'gpt-4o' };

  it('legacy sor (validatedTasks nincs) → átmeneti kegyelem: enged', () => {
    expect(examAllowsTask({ ...base, validatedTasks: undefined, validatedModel: undefined }, 'hooks')).toBe(
      true,
    );
  });

  it('bevizsgázott feladat megy, a többi nem', () => {
    const p = {
      ...base,
      validatedTasks: ['hooks' as const],
      validatedModel: providerFingerprint(base),
    };
    expect(examAllowsTask(p, 'hooks')).toBe(true);
    expect(examAllowsTask(p, 'assistant')).toBe(false);
  });

  it('modell-váltás a vizsga után → semmi nem megy (újra-vizsga kell)', () => {
    const p = {
      ...base,
      model: 'gpt-5o-uj',
      validatedTasks: ['hooks' as const],
      validatedModel: providerFingerprint(base), // a RÉGI modellre szól
    };
    expect(examAllowsTask(p, 'hooks')).toBe(false);
  });

  it('az ujjlenyomat a provider+baseUrl+model hármasra érzékeny', () => {
    expect(providerFingerprint(base)).not.toBe(providerFingerprint({ ...base, model: 'masik' }));
    expect(providerFingerprint(base)).not.toBe(
      providerFingerprint({ ...base, baseUrl: 'https://proxy.local' }),
    );
    expect(providerFingerprint(base)).toBe(providerFingerprint({ ...base }));
  });
});
