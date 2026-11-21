// Idővonal-szerkezeti AI-funkciók: AI Edit Engine (3 vágás-változat), Story Engine, Highlights.
const { z } = require('zod');
const { runStructured } = require('./runStructured');

// --- AI Edit Engine (P0-1): jelek → 3 vágás-változat -----------------------

const KeepSchema = z.object({
  start: z.number().describe('sáv kezdete az EREDETI idővonalon (mp)'),
  end: z.number().describe('sáv vége (mp)'),
});
const AutoCaptionSchema = z.object({
  text: z.string().describe('max ~40 karakter'),
  start: z.number().describe('az EREDETI idővonalon (mp) — a kliens remapeli'),
  duration: z.number(),
});
const AutoVariantSchema = z.object({
  id: z.enum(['viral', 'cinematic', 'fast']),
  title: z.string(),
  rationale: z.string().describe('rövid magyar indoklás a kártyára (1 mondat)'),
  keep: z.array(KeepSchema).min(1).describe('megtartandó sávok — a SORREND a story sorrendje'),
  captions: z.array(AutoCaptionSchema),
});
const AutoEditReplySchema = z.object({
  variants: z.array(AutoVariantSchema).length(3),
});

const AUTOEDIT_SYSTEM = `Te a "vided" AI Edit Engine-je vagy: nyers videó elemzett
jeleiből (jelenetváltások, beszéd-átirat, csendek, zenei beat-rács) állítasz
össze rövid, ütős short-form vágást. PONTOSAN 3 változatot adsz:
- "viral": hook az elejére (a legerősebb mondat/pillanat), gyors épülés, zárás
- "cinematic": jelenet-változatosság, nyugodtabb tempó, hosszabb snittek
- "fast": pörgős, csak a lényeg, csend és üresjárat nélkül

Szabályok:
- A keep-sávok az EREDETI idővonal másodperceiben értendők; a kliens fűzi össze
  őket — a listád SORRENDJE lesz a vágás sorrendje (átrendezhetsz!).
- A cél-hossz (targetSeconds) ±15%-án belül maradj (a keep-sávok összhossza).
- A csend-sávokat (silences) kerüld; vágj jelenethatárra (scenes) vagy beatre
  (beats), ha van a közelben.
- NE vágj mondat közepén: a transcript sorai mutatják a mondathatárokat.
- Ha van "shotScores" (vizuális minőség idővonal-pontokon: magasabb = szebb,
  élesebb kocka; faces>0 = arc van a képen), azonos értékű jelöltek közül a
  szebb kockájú szakaszt tartsd meg — a Cinematic változatnál ez a fő szempont.
- A captions a kimondott szövegből készül (rövidítve, max ~40 karakter),
  start = az EREDETI idővonal ideje (a kliens átszámolja).
- A rationale rövid, magyar, a felhasználónak szól.

Példa (12 mp-es anyag, target 6):
kontextus: transcript [{0.5-2.5 "Ez a legjobb tipp"}, {3-5 "amit valaha kaptam"},
{8-11 "próbáld ki te is"}], silences [{5-8}], scenes [6]
→ variants[0] (viral): keep [{"start":8,"end":11},{"start":0.4,"end":5}] —
  a záró felszólítás előre hookként, majd a magyarázat; captions a sorokból.`;

/**
 * @param context buildAutoEditContext kimenete (jelek + cél-hossz)
 * @returns {Promise<{variants: object[]}>}
 */
async function runAutoEdit(context, aiConfig) {
  return runStructured(
    AUTOEDIT_SYSTEM,
    `JELEK:\n${JSON.stringify(context, null, 1)}\n\nKészítsd el a 3 változatot.`,
    AutoEditReplySchema,
    aiConfig
  );
}

// --- 🎬 Story Engine (Phase 1.1): dramaturgia-térkép a beszédből -------------

const StoryReplySchema = z.object({
  chapters: z
    .array(
      z.object({
        start: z.number().describe('a fejezet kezdete az idővonalon (mp), 0-tól'),
        kind: z
          .enum(['hook', 'context', 'value', 'cta', 'other'])
          .describe('a szakasz dramaturgiai szerepe'),
      })
    )
    .describe('3–6 fejezet időrendben, az elsőnek 0 közelében kell kezdődnie'),
});

const STORY_SYSTEM = `A "vided" AI Story Engine-je vagy: egy short-form (TikTok/
Reels/Shorts) videó dramaturgiai TÉRKÉPÉT ismered fel a beszéd-átiratból és a
hosszból. A kimenet fejezetek listája — mindegyik egy idővonal-kezdettel (mp) és
egy szereppel:
- "hook": a figyelemfelkeltő nyitás (az első pillanatok, ami megállítja a görgetést)
- "context": felvezetés / háttér / a probléma vagy helyzet bemutatása
- "value": a lényeg — a magyarázat, a tartalom, a fizetség (a videó „húsa")
- "cta": lezárás / felszólítás (kövess, próbáld ki, kommentelj) a végén
- "other": ha egyik sem illik

Szabályok:
- 3–6 fejezet, IDŐRENDBEN növekvő "start"-tal; az első fejezet 0 körül kezdődjön.
- Ne szabdald túl: egy fejezet több mondatot foghat át. A vágás-pontokat a
  jelentés VÁLTÁSÁHOZ igazítsd (a transcript sorai mutatják a tartalmat + időt).
- A "start" mindig 0 és a videó hossza közé essen (mp).
- A klasszikus ív: hook (eleje) → context → value → cta (vége). Nem kötelező
  mind a négy, de a sorrend ez legyen.
- Ha nincs érdemi átirat, ossz időarányosan: hook az elején, value középen,
  cta a vége felé.
- A választ CSAK a séma szerinti JSON-ban add.

Példa (18 mp, transcript: [{0-3 "Sose csináld ezt vágásnál"}, {3-11 "mindig a
beszéd köré vágj, ne a zenéhez"}, {12-17 "próbáld ki és írd meg, működött-e"}])
→ {"chapters":[{"start":0,"kind":"hook"},{"start":3,"kind":"value"},{"start":12,"kind":"cta"}]}`;

/**
 * @param context { duration:number, transcript:[{start,end,text}] }
 * @returns {Promise<{chapters: {start:number, kind:string}[]}>}
 */
async function runStoryEngine(context, aiConfig) {
  return runStructured(
    STORY_SYSTEM,
    `A VIDEÓ JELEI:\n${JSON.stringify(context, null, 1)}\n\nAdd meg a fejezeteket.`,
    StoryReplySchema,
    aiConfig
  );
}

// --- 🎯 Highlights: long-form → több önálló short-jelölt (Phase 3.3) ---------

const HighlightsReplySchema = z.object({
  highlights: z
    .array(
      z.object({
        start: z.number().describe('a short kezdete az idővonalon (mp)'),
        end: z.number().describe('a short vége (mp)'),
        title: z.string().describe('rövid, ütős magyar cím a short-nak (max ~40 karakter)'),
        reason: z.string().describe('1 mondat: miért jó ez önálló short-nak'),
      })
    )
    .describe('2–4 nem-átfedő short-jelölt időrendben'),
});

const HIGHLIGHTS_SYSTEM = `Hosszú videóból ÖNÁLLÓ short-jelölteket választasz ki
(long-form → shorts). A beszéd-átirat és a hossz alapján adj 2–4 NEM ÁTFEDŐ
időablakot.

Szabályok:
- Mindegyik ablak 12–45 mp, és ÖNMAGÁBAN is érthető — erős pillanattal/hookkal
  kezdődjön, és legyen kerek vége (ne vágj mondat közepén; a transcript sorai
  mutatják a mondathatárokat).
- Az ablakok időrendben, ÁTFEDÉS NÉLKÜL; a start/end az idővonal másodperceiben,
  0 és a videó hossza között.
- Válaszd a legütősebb, önállóan is megálló részeket (tipp, poén, tanulság,
  fordulat) — ne csak az elejét.
- Minden ablakhoz rövid, ütős magyar cím + 1 mondatos indok.
- A választ CSAK a séma szerinti JSON-ban add.`;

/**
 * @param context { duration:number, transcript:[{start,end,text}] }
 * @returns {Promise<{highlights: {start,end,title,reason}[]}>}
 */
async function runHighlights(context, aiConfig) {
  return runStructured(
    HIGHLIGHTS_SYSTEM,
    `A VIDEÓ JELEI:\n${JSON.stringify(context, null, 1)}\n\nAdd meg a short-jelölteket.`,
    HighlightsReplySchema,
    aiConfig
  );
}

module.exports = { runAutoEdit, runStoryEngine, runHighlights };
