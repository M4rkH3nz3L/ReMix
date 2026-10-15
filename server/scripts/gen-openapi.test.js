const { buildOpenApi, toOpenApiPath, collectRoutes } = require('./gen-openapi');

describe('toOpenApiPath', () => {
  test('express :param → OpenAPI {param}', () => {
    expect(toOpenApiPath('/render/:id/file')).toBe('/render/{id}/file');
    expect(toOpenApiPath('/storage/:sourceId/list')).toBe('/storage/{sourceId}/list');
    expect(toOpenApiPath('/health')).toBe('/health');
  });
});

describe('buildOpenApi', () => {
  const routes = [
    { method: 'POST', path: '/ai/hooks' },
    { method: 'GET', path: '/render/:id/file' },
    { method: 'GET', path: '/health' },
  ];
  const inventory = [
    { level: 'AUTHENTICATED', method: 'POST', path: '/ai/hooks', rateClass: 'ai' },
  ];

  test('érvényes OpenAPI 3.1 doc, paths-szal', () => {
    const doc = buildOpenApi(routes, inventory);
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toMatch(/ReMix/);
    expect(Object.keys(doc.paths).length).toBe(3);
  });

  test('a policy-szint + rate-class a leltárból jön', () => {
    const doc = buildOpenApi(routes, inventory);
    expect(doc.paths['/ai/hooks'].post['x-policy']).toBe('AUTHENTICATED');
    expect(doc.paths['/ai/hooks'].post['x-rate-class']).toBe('ai');
    expect(doc.paths['/ai/hooks'].post.responses).toHaveProperty('400');
  });

  test('leltárban NEM szereplő route → x-policy PUBLIC, rate-class default', () => {
    const doc = buildOpenApi(routes, inventory);
    expect(doc.paths['/health'].get['x-policy']).toBe('PUBLIC');
    expect(doc.paths['/health'].get['x-rate-class']).toBe('default');
  });

  test('path-paraméter konverzió a kulcsban', () => {
    const doc = buildOpenApi(routes, inventory);
    expect(doc.paths['/render/{id}/file']).toBeDefined();
    expect(doc.paths['/render/{id}/file'].get).toBeDefined();
  });
});

describe('collectRoutes', () => {
  test('közvetlen route-okat gyűjt a stackből', () => {
    const fakeStack = [
      { route: { path: '/a', methods: { get: true } } },
      { route: { path: '/b', methods: { post: true } } },
    ];
    const routes = collectRoutes(fakeStack, '');
    expect(routes).toEqual([
      { method: 'GET', path: '/a' },
      { method: 'POST', path: '/b' },
    ]);
  });

  test('mountolt sub-router route-jait is bejárja', () => {
    const fakeStack = [
      { name: 'router', handle: { stack: [{ route: { path: '/sub', methods: { post: true } } }] } },
    ];
    const routes = collectRoutes(fakeStack, '');
    expect(routes).toEqual([{ method: 'POST', path: '/sub' }]);
  });
});
