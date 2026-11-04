// 📜 A kézi végpont-szerződés rákerül a generált OpenAPI-ra, és a policy-mezők megmaradnak.
const { buildOpenApi } = require('./scripts/gen-openapi');

test('a /posts/{id}/download pontos válaszalakkal és hibakódokkal', () => {
  const doc = buildOpenApi([{ method: 'GET', path: '/posts/:id/download' }], [{ level: 'AUTHENTICATED', method: 'GET', path: '/posts/:id/download' }]);
  const op = doc.paths['/posts/{id}/download'].get;
  expect(op['x-policy']).toBe('AUTHENTICATED');
  expect(op.responses[200].content['application/json'].schema.properties.variant.enum).toEqual(['watermarked', 'clean']);
  expect(op.responses[403].content['application/json'].schema.properties.error.enum).toEqual(['download_disabled']);
  expect(op.responses[409].content['application/json'].schema.properties.error.enum).toEqual(['not_rendered']);
});

test('a generált openapi.json is tartalmazza (újragenerálás után)', () => {
  const doc = require('./openapi.json');
  expect(doc.paths['/posts/{id}/download'].get.responses[200].content['application/json'].schema.required).toEqual(['url', 'variant', 'expiresAt', 'filename']);
  expect(doc.paths['/media/signed'].get.responses[403]).toBeDefined();
});
