// 📜 Kézzel rögzített végpont-szerződések (az openapi.json generátora beolvasztja őket a route-
// fából kapott általános leírás fölé). Ide az a végpont kerül, amelyre a kliens pontos alakkal épít.

const err = (codes) => ({ type: 'object', required: ['error'], properties: { error: { type: 'string', enum: codes } } });

const CONTRACTS = {
  // ⬇️ PRO-CASH C2.6 — feed-videó letöltése (D1, D11)
  'get /posts/{id}/download': {
    summary: 'Feed-poszt videójának letöltése (Free és mások posztja: vízjeles; a fizetős tulajdonos saját posztja: tiszta)',
    description:
      'A szint a verifikált tokenből jön (a kliens kérése nem számít). A válasz egy rövid életű (10 perc), ' +
      'aláírt link a `/media/signed` végpontra; a fájl `Content-Disposition: attachment` fejléccel jön. ' +
      'A vízjeles változat az első kéréskor készül (néhány másodperc), utána gyorsítótárazva.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    responses: {
      200: {
        description: 'Aláírt letöltési link',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['url', 'variant', 'expiresAt', 'filename'],
              properties: {
                url: { type: 'string', format: 'uri', description: 'GET-tel letölthető; lejárat után 403 invalid_signature' },
                variant: { type: 'string', enum: ['watermarked', 'clean'] },
                expiresAt: { type: 'string', format: 'date-time' },
                filename: { type: 'string', example: 'Proba_poszt.mp4' },
              },
            },
          },
        },
      },
      401: { description: 'Nincs (érvényes) token', content: { 'application/json': { schema: err(['unauthorized']) } } },
      403: { description: 'Az alkotó letiltotta a letöltést (a tulajdonosra nem vonatkozik)', content: { 'application/json': { schema: err(['download_disabled']) } } },
      404: { description: 'Nincs ilyen poszt, vagy a hívó nem láthatja (privát / csak követőknek / tiltás / eltávolítva)', content: { 'application/json': { schema: err(['not_found']) } } },
      409: { description: 'A posztnak még nincs videója a ReMix-tárban', content: { 'application/json': { schema: err(['not_rendered']) } } },
      429: { description: 'Rate-limit (render-osztály)' },
      500: { description: 'Váratlan hiba', content: { 'application/json': { schema: err(['download_failed']) } } },
      503: { description: 'A tár nincs konfigurálva, vagy a vízjelezés átmenetileg nem sikerült (újrapróbálható)', content: { 'application/json': { schema: err(['storage_unavailable', 'watermark_unavailable']) } } },
    },
  },
  'get /media/signed': {
    summary: 'Aláírt, rövid életű média-kiszolgálás (a tár privát lehet)',
    parameters: [
      { name: 'key', in: 'query', required: true, schema: { type: 'string' } },
      { name: 'exp', in: 'query', required: true, schema: { type: 'integer', description: 'Unix-másodperc' } },
      { name: 'sig', in: 'query', required: true, schema: { type: 'string', description: 'HMAC-SHA256 hex' } },
      { name: 'name', in: 'query', required: false, schema: { type: 'string', description: 'letöltési fájlnév' } },
    ],
    responses: {
      200: { description: 'A fájl (video/mp4), `Cache-Control: private, no-store`' },
      403: { description: 'Hibás vagy lejárt aláírás', content: { 'application/json': { schema: err(['invalid_signature']) } } },
      404: { description: 'A fájl nincs meg', content: { 'application/json': { schema: err(['not_found']) } } },
    },
  },
};

/** A szerződés ráhúzása egy generált path-műveletre (a policy- és rate-mezők megmaradnak). */
function applyContracts(paths) {
  for (const [key, contract] of Object.entries(CONTRACTS)) {
    const [method, p] = key.split(' ');
    if (paths[p] && paths[p][method]) {
      paths[p][method] = { ...paths[p][method], ...contract };
    }
  }
  return paths;
}

module.exports = { CONTRACTS, applyContracts };
