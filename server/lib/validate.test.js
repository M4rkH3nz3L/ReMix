const { z } = require('zod');
const { validate, validateJsonField } = require('./validate');

/** Lefuttatja a middleware-t és visszaadja a next()-nek átadott hibát (vagy undefined). */
function run(mw, req) {
  return new Promise((resolve) => {
    mw(req, {}, (err) => resolve(err));
  });
}

const bodySchema = z.object({ notes: z.array(z.unknown()).min(1) }).passthrough();

describe('validate(body)', () => {
  test('jó body → next() hiba nélkül; a parszolt adat visszaíródik (passthrough megőrzi az extrát)', async () => {
    const req = { body: { notes: [1, 2], extra: 'x' } };
    const err = await run(validate(bodySchema), req);
    expect(err).toBeUndefined();
    expect(req.body.notes).toEqual([1, 2]);
    expect(req.body.extra).toBe('x');
  });

  test('rossz body → next(HttpError 400) code+issues-szel', async () => {
    const req = { body: { notes: [] } };
    const err = await run(validate(bodySchema), req);
    expect(err).toBeDefined();
    expect(err.status).toBe(400);
    expect(err.code).toBe('validation');
    expect(Array.isArray(err.issues)).toBe(true);
    expect(err.issues[0].path).toBe('notes');
  });
});

describe('validateJsonField', () => {
  const stepsSchema = z.array(z.unknown()).min(1);

  test('jó JSON-string mező → req.valid[field] parszolt érték', async () => {
    const req = { body: { steps: JSON.stringify([1, 2, 3]) } };
    const err = await run(validateJsonField('steps', stepsSchema), req);
    expect(err).toBeUndefined();
    expect(req.valid.steps).toEqual([1, 2, 3]);
  });

  test('hibás JSON-string → 400', async () => {
    const req = { body: { steps: '{nem json' } };
    const err = await run(validateJsonField('steps', stepsSchema), req);
    expect(err.status).toBe(400);
  });

  test('séma-bukás (üres tömb) → 400 issues', async () => {
    const req = { body: { steps: '[]' } };
    const err = await run(validateJsonField('steps', stepsSchema), req);
    expect(err.status).toBe(400);
    expect(err.issues).toBeDefined();
  });

  test('hiányzó mező + optional → átenged', async () => {
    const req = { body: {} };
    const err = await run(validateJsonField('steps', stepsSchema, { optional: true }), req);
    expect(err).toBeUndefined();
  });

  test('hiányzó mező (kötelező) → 400', async () => {
    const req = { body: {} };
    const err = await run(validateJsonField('steps', stepsSchema), req);
    expect(err.status).toBe(400);
  });
});
