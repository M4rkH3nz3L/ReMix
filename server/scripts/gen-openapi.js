// 📜 OpenAPI/route-kontraktus generátor (01-api-architecture §01.4).
//
// A route-leltárból (security/authorization `routeInventory`) + a bootolt app
// teljes route-fájából statikus OpenAPI 3.1 dokumentumot ad ki (method/path +
// policy-szint + rate-class), amit a kliens `*Client.ts` kontraktjához lehet
// kötni (§13.4). A `/health/routes` a FUTÁSIDEJŰ leltár; ez a STATIKUS kontraktus.
//
// Futtatás:  node scripts/gen-openapi.js   → server/openapi.json
//
// A `buildOpenApi()` SZÁNDÉKOSAN pure (app-boot nélkül tesztelhető); a CLI-rész
// köti a bootolt apphoz ( a boot node-runtime, nem jest — így az ESM-deps OK).

const fs = require('fs');
const path = require('path');

/** express path-paraméter (`:id`) → OpenAPI (`{id}`). */
function toOpenApiPath(p) {
  return p.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

/**
 * PURE: route-lista + policy-leltár → OpenAPI 3.1 doc.
 * @param {{method:string, path:string}[]} routes  (method nagybetűs)
 * @param {{level:string, method:string, path:string, rateClass:?string}[]} inventory
 */
function buildOpenApi(routes, inventory = []) {
  const invByKey = new Map();
  for (const r of inventory) {
    if (r.method && r.path) {
      invByKey.set(`${r.method.toUpperCase()} ${r.path}`, r);
    }
  }
  const paths = {};
  for (const route of routes) {
    const method = String(route.method || '').toLowerCase();
    if (!method) {
      continue;
    }
    const oaPath = toOpenApiPath(route.path);
    const inv = invByKey.get(`${route.method.toUpperCase()} ${route.path}`);
    paths[oaPath] = paths[oaPath] || {};
    paths[oaPath][method] = {
      'x-policy': inv ? inv.level : 'PUBLIC',
      'x-rate-class': inv && inv.rateClass ? inv.rateClass : 'default',
      responses: {
        200: { description: 'OK' },
        400: { description: 'Validációs hiba — { error, code, issues }' },
        401: { description: 'Hitelesítés szükséges' },
        402: { description: 'Pro/előfizetés szükséges' },
        429: { description: 'Rate-limit / kvóta' },
        500: { description: 'Szerverhiba — { error }' },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: { title: 'ReMix backend (vided render worker)', version: '0.1.0' },
    paths,
  };
}

/** A bootolt Express-app teljes route-fája (mountolt sub-routerekkel). */
function collectRoutes(stack, prefix, out) {
  out = out || [];
  for (const layer of stack) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).filter((m) => layer.route.methods[m]);
      for (const m of methods) {
        out.push({ method: m.toUpperCase(), path: prefix + layer.route.path });
      }
    } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
      collectRoutes(layer.handle.stack, prefix, out);
    }
  }
  return out;
}

module.exports = { buildOpenApi, toOpenApiPath, collectRoutes };

if (require.main === module) {
  process.env.ALLOW_INSECURE_DEV = process.env.ALLOW_INSECURE_DEV || '1';
  const app = require('../index');
  const { routeInventory } = require('../security/authorization');
  const routes = collectRoutes(app._router.stack, '');
  const doc = buildOpenApi(routes, routeInventory());
  const outFile = path.join(__dirname, '..', 'openapi.json');
  fs.writeFileSync(outFile, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  console.log(`✓ openapi.json kész — ${Object.keys(doc.paths).length} path, ${routes.length} művelet → ${outFile}`);
  process.exit(0);
}
