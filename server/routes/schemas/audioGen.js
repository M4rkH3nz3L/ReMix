// 🎚️ Zod-sémák a hang-generáló route-okhoz (01-api-architecture §01.2).
//
// SZÁNDÉKOSAN permisszívek: a cél a vak `req.body.x` kiváltása determinisztikus
// 400-ra a MALFORMÁLT inputnál (üres/hiányzó hangjegy/ütés/lépés), NEM a valid
// bemenetek viselkedésének megváltoztatása. A számszerű mezők (bpm/bars) a
// handlerben `Number(...)||default`-tal mennek tovább, ezért itt lazák maradnak.
// A `.passthrough()` megőrzi a handler által olvasott nyers mezőket.

const { z } = require('zod');

const synthBody = z
  .object({ notes: z.array(z.unknown()).min(1, 'Nincs hangjegy.') })
  .passthrough();

const drumsBody = z
  .object({ hits: z.array(z.unknown()).min(1, 'Nincs dob-ütés.') })
  .passthrough();

// a /sampler multipart `steps` JSON-string mezője
const samplerSteps = z.array(z.unknown()).min(1, 'Nincs lépés.');

module.exports = { synthBody, drumsBody, samplerSteps };
