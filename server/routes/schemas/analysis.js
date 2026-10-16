// 🎛️ Zod-séma az analysis-router JSON-végpontjához (01-api-architecture §01.2).
//
// /vision/query: a handler `!query || !Array.isArray(docs) || docs.length === 0`
// ellenőrzésének HŰ tükre (query truthy + docs nem-üres tömb). A többi analysis-
// route multipart (fájl-alapú), azoknál a handler a fájl-hiányt 400-zza.

const { z } = require('zod');

module.exports = {
  visionQuery: z
    .object({
      query: z.unknown().refine((v) => !!v, { message: 'Hiányzó lekérdezés.' }),
      docs: z.array(z.unknown()).min(1, 'Hiányzó dokumentumok.'),
    })
    .passthrough(),
};
