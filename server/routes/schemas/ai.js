// 🤖 Zod-sémák az AI-router mező-ellenőrzéséhez (01-api-architecture §01.2).
//
// HŰ a handlerek jelenlegi elfogadásához (behavior-preserving): pontosan azt
// utasítja el, amit a handler is 400-zott, és a `.passthrough()` megőrzi a handler
// által olvasott többi mezőt (aiConfig, context, lang). A /ai/probe SZÁNDÉKOSAN
// kimarad — az tolerálja a hiányzó configot (200 { ok:false }).

const { z } = require('zod');

const nonEmptyStr = z.string().min(1);
// a handler `!context || typeof context !== 'object'` ellenőrzésének pontos tükre
// (az objektum ÉS a tömb is átmegy, a null/undefined/primitív nem)
const objectCtx = z
  .unknown()
  .refine((v) => !!v && typeof v === 'object', { message: 'Hiányzó kontextus.' });

module.exports = {
  // summary: nem-üres string (hooks + thumbheadlines)
  hooks: z.object({ summary: nonEmptyStr }).passthrough(),
  thumbheadlines: z.object({ summary: nonEmptyStr }).passthrough(),
  // segments: nem-üres tömb (translate + captionstudio); a lang-ot a handler ellenőrzi
  translate: z.object({ segments: z.array(z.unknown()).min(1) }).passthrough(),
  captionstudio: z.object({ segments: z.array(z.unknown()).min(1) }).passthrough(),
  // context: objektum/tömb (highlights + story + autoedit)
  highlights: z.object({ context: objectCtx }).passthrough(),
  story: z.object({ context: objectCtx }).passthrough(),
  autoedit: z.object({ context: objectCtx }).passthrough(),
  // instruction: nem-üres string (assist)
  assist: z.object({ instruction: nonEmptyStr }).passthrough(),
};
