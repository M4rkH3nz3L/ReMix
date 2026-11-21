// AI-asszisztens: a parancs-whitelist sémái, a rendszer-prompt és a runAssistant.
const { z } = require('zod');
const { runStructured } = require('./runStructured');

/** csak az AI által szerkeszthető klip-mezők — ez a whitelist a validátor magja */
const PatchSchema = z
  .object({
    start: z.number().describe('kezdet az idővonalon (mp)'),
    duration: z.number().describe('hossz (mp)'),
    text: z.string(),
    color: z.string().describe('hex szín, pl. #ffffff'),
    backgroundColor: z.string().nullable(),
    fontSize: z.number().describe('a vászon magasságának %-a, 3-20'),
    position: z.object({ x: z.number(), y: z.number() }).describe('0-1 normalizált középpont'),
    animation: z.enum(['none', 'fade', 'slide', 'pulse', 'typewriter', 'pop', 'shake', 'karaoke']),
    stylePreset: z.enum(['plain', 'bubble', 'outline', 'neon']),
    speed: z.number().describe('lejátszási sebesség 0.25-4'),
    volume: z.number().describe('0-1'),
    filterId: z.enum(['none', 'warm', 'cool', 'mono', 'vivid', 'fade', 'night', 'retro', 'sunset', 'forest']),
    filterIntensity: z.number().describe('0.1-1'),
    fadeInSec: z.number().describe('beúszás feketéből (mp, 0-2)'),
    fadeOutSec: z.number().describe('kiúszás feketébe (mp, 0-2)'),
    opacity: z.number().describe('0.1-1'),
    trimIn: z.number().describe('forrásfájlon belüli kezdőpont (mp)'),
    // 🎬 kimenő átmenet a KÖVETKEZŐ klipre (az első klipre tedd)
    transitionOut: z.object({
      type: z.enum([
        'zoom', 'spin', 'flip', 'cube', 'circle', 'dissolve', 'wipeLeft', 'wipeRight',
        'wipeUp', 'wipeDown', 'slideLeft', 'slideRight', 'pixelize', 'blur',
        'fadeBlack', 'fadeWhite', 'radial',
      ]),
      duration: z.number().describe('mp, 0.2-1.5'),
    }),
    // 🎨 szín-korrekció (a klip saját grade-je)
    adjust: z
      .object({
        brightness: z.number().describe('-0.3–0.3'),
        contrast: z.number().describe('-0.4–0.4'),
        saturation: z.number().describe('-1–1 (−1 = fekete-fehér)'),
        temperature: z.number().describe('-0.3–0.3 (meleg↔hideg)'),
        vignette: z.number().describe('0–1'),
      })
      .partial(),
  })
  .partial();

const NewTextClipSchema = z.object({
  text: z.string(),
  start: z.number().describe('kezdet (mp)'),
  duration: z.number().describe('hossz (mp)'),
  color: z.string().optional(),
  fontSize: z.number().optional().describe('a vászon magasságának %-a; felirat: 5, cím: 7'),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  animation: z
    .enum(['none', 'fade', 'slide', 'pulse', 'typewriter', 'pop', 'shake', 'karaoke'])
    .optional(),
  stylePreset: z.enum(['plain', 'bubble', 'outline', 'neon']).optional(),
});

const CommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('UPDATE_CLIP'), clipId: z.string(), patch: PatchSchema }),
  z.object({ type: z.literal('REMOVE_CLIP'), clipId: z.string() }),
  z.object({
    type: z.literal('SPLIT_CLIP'),
    clipId: z.string(),
    time: z.number().describe('vágáspont az idővonalon (mp)'),
  }),
  z.object({
    type: z.literal('ADD_TEXT_CLIPS'),
    trackType: z.enum(['text', 'captions', 'overlay']).describe('text=cím, captions=felirat, overlay=matrica'),
    clips: z.array(NewTextClipSchema),
    reason: z
      .string()
      .optional()
      .describe('rövid magyar indok (miért kell ez a felirat/cím) — a „miért van itt?" jelzéshez'),
  }),
  z.object({ type: z.literal('SET_ASPECT'), aspectRatio: z.enum(['16:9', '9:16', '1:1']) }),
  z.object({ type: z.literal('RENAME_PROJECT'), name: z.string() }),
]);

const ReplySchema = z.object({
  message: z.string().describe('rövid magyar összefoglaló a felhasználónak: mit és miért'),
  commands: z.array(CommandSchema),
});

const SYSTEM = `Te a "vided" TikTok/Reels/Shorts-fókuszú videószerkesztő AI-asszisztense vagy.
A felhasználó projekt-kontextust és egy utasítást küld; te KIZÁRÓLAG a megadott
parancs-sémán keresztül szerkesztesz. A parancsaidat a kliens validálja és
visszavonhatóan hajtja végre.

Szabályok:
- Minden idő másodpercben, minden pozíció 0-1 közé normalizálva (középpont).
- Ha a kontextusban van "transcript" (a videók beszéde idővonal-időben), arra
  alapozz: feliratokhoz a kimondott szöveget és annak időzítését használd,
  vágásnál/rövidítésnél a beszéd nélküli vagy ismétlődő részeket célozd.
- Feliratok (captions): alsó harmad (y≈0.78), rövid sorok (max ~40 karakter),
  'bubble' stílus, 'pop' animáció az alapértelmezés. Címek (text): felső harmad.
- Csak akkor törölj klipet, ha a felhasználó kifejezetten kéri vagy az utasítás
  egyértelműen ezt jelenti (pl. "rövidítsd" → duration csökkentés vagy törlés a
  végéről).
- Tartsd tiszteletben a korábbi eseménynaplóban látható felhasználói döntéseket.
- Ha az utasítás nem teljesíthető a rendelkezésre álló parancsokkal, adj üres
  commands listát, és a message-ben magyarázd el, mit tudnál helyette.
- A message CSAK azt írhatja le, amit a commands lista TÉNYLEGESEN tartalmaz —
  ha a commands üres, ne állítsd, hogy elvégeztél bármit.
- A message mindig magyar, tömör, és a felhasználónak szól.
- ADD_TEXT_CLIPS-nél adj egy rövid magyar "reason" mezőt (1 tömör mondat: miért
  kell ez a felirat/cím) — ez lesz a klip „miért van itt?" indoklása.
- ÁTMENET két klip közé: az ELSŐ klipre tedd az UPDATE_CLIP patch.transitionOut-ot
  ({type, duration}); a duration 0.2–1.5 mp.
- SZÍN/hangulat: UPDATE_CLIP patch.adjust ({brightness/contrast/saturation/
  temperature/vignette}) — csak a valóban kért mezőket add meg, a tartományon belül.
- IDŐSÁVRA szóló utasítás (pl. "az első 5 mp", "a közepén", "az utolsó snitt"):
  a kontextus klip-listájából (start/duration) keresd ki az ADOTT IDŐSÁVBA eső
  klipeket, és MINDEGYIKRE adj külön UPDATE_CLIP-et — ne csak egyre.
- HANGULAT/energia-utasítás (pl. "legyen agresszívabb / pörgősebb / energikusabb
  / nyugodtabb / filmesebb"): NE kérj vissza, hanem fordítsd le TÖBB mező
  együttes állítására a megcélzott klipeken:
  · agresszív / pörgős / energikus → speed 1.2–1.5, filterId 'vivid',
    adjust.contrast +0.15–0.25 és saturation +0.15–0.3, rövid gyors átmenet
    (transitionOut zoom/flip, 0.2–0.3 mp);
  · nyugodt / filmes / lágy → speed 0.9–1.0, filterId 'warm' vagy 'sunset',
    adjust.temperature +0.1, hosszabb 'dissolve' átmenet (0.6–1.0 mp).

Példák (utasítás → commands):
- "Nevezd át a projektet Vlogra" → [{"type":"RENAME_PROJECT","name":"Vlog"}]
- "Legyen négyzetes a videó" → [{"type":"SET_ASPECT","aspectRatio":"1:1"}]
- "Vágd ketté a c12 klipet 3 mp-nél" → [{"type":"SPLIT_CLIP","clipId":"c12","time":3}]
- "Halkítsd le a c3-at" → [{"type":"UPDATE_CLIP","clipId":"c3","patch":{"volume":0.3}}]
- "Tegyél feloldó átmenetet a c1 után" → [{"type":"UPDATE_CLIP","clipId":"c1","patch":{"transitionOut":{"type":"dissolve","duration":0.5}}}]
- "Legyen a c2 melegebb és kontrasztosabb" → [{"type":"UPDATE_CLIP","clipId":"c2","patch":{"adjust":{"temperature":0.15,"contrast":0.15}}}]
- "Legyen az első 5 mp agresszívabb" (kontextus: c1 0–3s, c2 3–6s) →
  [{"type":"UPDATE_CLIP","clipId":"c1","patch":{"speed":1.3,"filterId":"vivid","adjust":{"contrast":0.2,"saturation":0.25},"transitionOut":{"type":"zoom","duration":0.25}}},
   {"type":"UPDATE_CLIP","clipId":"c2","patch":{"speed":1.3,"filterId":"vivid","adjust":{"contrast":0.2}}}]`;

/**
 * @param context a kliens által épített rétegzett projekt-kontextus (objektum)
 * @param instruction a felhasználó utasítása
 * @returns {Promise<{message: string, commands: object[]}>}
 */
async function runAssistant(context, instruction, aiConfig) {
  return runStructured(
    SYSTEM,
    `PROJEKT-KONTEXTUS:\n${JSON.stringify(context, null, 1)}\n\nUTASÍTÁS: ${instruction}`,
    ReplySchema,
    aiConfig
  );
}

module.exports = { runAssistant };
