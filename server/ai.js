// AI-asszisztens (full-plan F3): a kliens rétegzett projekt-kontextust küld,
// a modell egy szigorú parancs-whitelistből ad vissza műveleteket (structured
// output), amit a kliens validál és a Command Bus-on hajt végre. Az AI sosem
// írja közvetlenül a projektet.
const Anthropic = require('@anthropic-ai/sdk');
const { zodOutputFormat } = require('@anthropic-ai/sdk/helpers/zod');
const { z } = require('zod');

const MODEL = process.env.AI_MODEL || 'claude-opus-4-8';

// Lokális AI (dev): Ollama a fejlesztő gépen — ANTHROPIC_API_KEY nélkül ez fut.
// A modell szándékosan könnyen cserélhető (LOCAL_AI_MODEL env); az alap a
// qwen3:14b (jó minőség/sebesség M1 Max + 64 GB-on, strukturált kimenettel).
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const LOCAL_MODEL = process.env.LOCAL_AI_MODEL || 'qwen3:14b';

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

Példák (utasítás → commands):
- "Nevezd át a projektet Vlogra" → [{"type":"RENAME_PROJECT","name":"Vlog"}]
- "Legyen négyzetes a videó" → [{"type":"SET_ASPECT","aspectRatio":"1:1"}]
- "Vágd ketté a c12 klipet 3 mp-nél" → [{"type":"SPLIT_CLIP","clipId":"c12","time":3}]
- "Halkítsd le a c3-at" → [{"type":"UPDATE_CLIP","clipId":"c3","patch":{"volume":0.3}}]`;

/** a lokális runtime elérhetősége — rövid cache-sel, hogy a /health gyors legyen */
let localProbe = { at: 0, ok: false };
async function localAvailable() {
  if (Date.now() - localProbe.at < 30 * 1000) {
    return localProbe.ok;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: controller.signal });
    clearTimeout(timer);
    const body = await res.json();
    const models = (body.models ?? []).map((m) => m.name);
    localProbe = { at: Date.now(), ok: models.some((n) => n.startsWith(LOCAL_MODEL.split(':')[0])) };
  } catch {
    localProbe = { at: Date.now(), ok: false };
  }
  return localProbe.ok;
}

async function aiProvider() {
  if (process.env.ANTHROPIC_API_KEY) {
    return 'anthropic';
  }
  if (await localAvailable()) {
    return 'local';
  }
  return null;
}

async function aiAvailable() {
  return (await aiProvider()) !== null;
}

async function runAnthropic(system, userContent, schema) {
  const client = new Anthropic();
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    system,
    messages: [{ role: 'user', content: userContent }],
    output_config: { format: zodOutputFormat(schema) },
  });
  if (response.stop_reason === 'refusal') {
    throw new Error('A modell elutasította a kérést.');
  }
  if (!response.parsed_output) {
    throw new Error('A modell válasza nem volt értelmezhető.');
  }
  return response.parsed_output;
}

async function runLocal(system, userContent, schema) {
  const body = {
    model: LOCAL_MODEL,
    stream: false,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
    // kényszerített JSON-séma kimenet (Ollama structured outputs)
    format: z.toJSONSchema(schema),
    options: { temperature: 0.2, num_ctx: 16384 },
  };
  // a gondolkodó modellek (qwen3/deepseek-r1) direktben válaszoljanak —
  // a strukturált kimenethez a thinking csak latenciát adna
  if (/^(qwen3|deepseek-r1|magistral)/.test(LOCAL_MODEL)) {
    body.think = false;
  }
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Lokális AI hiba (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const reply = await res.json();
  let parsed;
  try {
    parsed = schema.safeParse(JSON.parse(reply.message?.content ?? ''));
  } catch {
    throw new Error('A lokális modell válasza nem volt érvényes JSON.');
  }
  if (!parsed.success) {
    throw new Error('A lokális modell válasza nem felelt meg a sémának.');
  }
  return parsed.data;
}

/** provider-független strukturált hívás — minden AI-funkció ezen megy át */
async function runStructured(system, userContent, schema) {
  const provider = await aiProvider();
  if (provider === 'anthropic') {
    return runAnthropic(system, userContent, schema);
  }
  if (provider === 'local') {
    return runLocal(system, userContent, schema);
  }
  throw new Error(
    `Nincs elérhető AI: állíts be ANTHROPIC_API_KEY-t, vagy indítsd el az Ollamát ` +
      `(ollama serve + ollama pull ${LOCAL_MODEL}).`
  );
}

/**
 * @param context a kliens által épített rétegzett projekt-kontextus (objektum)
 * @param instruction a felhasználó utasítása
 * @returns {Promise<{message: string, commands: object[]}>}
 */
async function runAssistant(context, instruction) {
  return runStructured(
    SYSTEM,
    `PROJEKT-KONTEXTUS:\n${JSON.stringify(context, null, 1)}\n\nUTASÍTÁS: ${instruction}`,
    ReplySchema
  );
}

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
async function runAutoEdit(context) {
  return runStructured(
    AUTOEDIT_SYSTEM,
    `JELEK:\n${JSON.stringify(context, null, 1)}\n\nKészítsd el a 3 változatot.`,
    AutoEditReplySchema
  );
}

// --- ✨ Caption Studio (P1): kiemelt szavak + emoji a feliratokhoz -----------

const CaptionStudioReplySchema = z.object({
  segments: z.array(
    z.object({
      id: z.string().describe('a bemeneti szegmens id-ja változatlanul'),
      emphasis: z
        .array(z.number())
        .describe('a kiemelendő szavak 0-alapú indexei (max 2, lehet üres)'),
      emoji: z.string().describe('EGY illő emoji, vagy üres string, ha nem kell'),
    })
  ),
});

const CAPTION_STUDIO_SYSTEM = `Feliratok "emphasis"-elemzője vagy egy TikTok/Reels
videószerkesztőben. Minden szegmensre add meg: mely szavakat érdemes vizuálisan
kiemelni (0-alapú index a szóközök szerinti bontásban), és egy odaillő emojit.

Szabályok:
- Kiemelés: a jelentést hordozó, ütős szavak (számok, felsőfok, érzelem,
  kulcsfogalom) — szegmensenként LEGFELJEBB 2, és ha nincs erős jelölt, üres
  lista. Kötőszót, névelőt SOHA ne emelj ki.
- Emoji: csak ha tényleg illik (érzelem/téma) — különben üres string. Soha ne
  adj egynél többet.
- A választ CSAK a séma szerinti JSON-ban add.

Példák:
bemenet: [{"id":"c1","text":"Ez a tipp 10x gyorsabbá tesz"}]
→ {"segments":[{"id":"c1","emphasis":[3,4],"emoji":"⚡"}]}
bemenet: [{"id":"c2","text":"és aztán elmentünk haza"}]
→ {"segments":[{"id":"c2","emphasis":[],"emoji":""}]}
bemenet: [{"id":"c3","text":"Ez volt életem legjobb döntése"}]
→ {"segments":[{"id":"c3","emphasis":[3],"emoji":"🔥"}]}`;

/**
 * @param segments [{id, text}] felirat-szegmensek
 * @returns {Promise<{segments: [{id, emphasis, emoji}]}>}
 */
async function runCaptionStudio(segments) {
  return runStructured(
    CAPTION_STUDIO_SYSTEM,
    `SZEGMENSEK:\n${JSON.stringify(segments, null, 1)}`,
    CaptionStudioReplySchema
  );
}

// --- 🎬 Thumbnail headline-javaslatok (CC V2) --------------------------------

const ThumbHeadlineSchema = z.object({
  headlines: z
    .array(z.string())
    .describe('pontosan 3 ütős magyar borítókép-cím, egyenként MAX 22 karakter'),
});

const THUMB_SYSTEM = `Borítókép-címeket (thumbnail headline) írsz TikTok/YouTube
videókhoz, magyarul. Szabályok:
- PONTOSAN 3 változat, egyenként LEGFELJEBB 22 karakter.
- Ütős, kíváncsiságkeltő, de a témához hű — clickbait-hazugság nélkül.
- Emoji és idézőjel nélkül; ne kezdődjön mind számmal.
- A választ CSAK a séma szerinti JSON-ban add.

Példák:
bemenet: "utazás vlog a Balatonnál, naplemente, szörf"
→ {"headlines":["Ezt látnod kell!","Balaton másképp","A tökéletes nyár"]}
bemenet: "5 tipp a gyorsabb vágáshoz kezdőknek"
→ {"headlines":["5 vágás-titok","Így vágj gyorsan","Kezdő hibák STOP"]}`;

/**
 * @param summary rövid téma-összefoglaló (projektnév + átirat-részlet)
 * @returns {Promise<{headlines: string[]}>}
 */
async function runThumbHeadlines(summary) {
  return runStructured(THUMB_SYSTEM, `TÉMA/ÁTIRAT:\n${summary}`, ThumbHeadlineSchema);
}

// --- 🪝 Hook Generator (P2): erősebb nyitómondatok ------------------------

const HookReplySchema = z.object({
  hooks: z
    .array(
      z.object({
        text: z.string().describe('a nyitómondat, MAX 40 karakter'),
        style: z
          .string()
          .describe('a hook fajtája 1-2 szóban: kérdés / szám / ellentmondás / FOMO / ígéret'),
      })
    )
    .describe('pontosan 6 KÜLÖNBÖZŐ stílusú nyitómondat'),
});

const HOOK_SYSTEM = `TikTok/Reels nyitómondatokat („hook") írsz magyarul. Az első
2 másodperc dönt: a hook állítsa meg a görgetést.

Szabályok:
- PONTOSAN 6 változat, egyenként LEGFELJEBB 40 karakter.
- KÜLÖNBÖZŐ fajták legyenek: kérdés · szám/lista · ellentmondás · FOMO ·
  ígéret · személyes vallomás.
- A videó TÉMÁJÁHOZ hűen — ne ígérj olyat, ami nincs benne.
- Nincs hashtag, nincs emoji, nincs idézőjel.
- A választ CSAK a séma szerinti JSON-ban add.

Példák:
téma: "vágás-tippek kezdőknek, gyorsbillentyűk"
→ {"hooks":[{"text":"Még mindig egérrel vágsz?","style":"kérdés"},
{"text":"3 gomb, feleannyi munka","style":"szám"},
{"text":"A lassú vágás nem tehetség kérdése","style":"ellentmondás"},
{"text":"Ezt senki nem mutatja meg kezdőként","style":"FOMO"},
{"text":"5 perc alatt gyorsabb leszel","style":"ígéret"},
{"text":"Két évig csináltam rosszul","style":"vallomás"}]}`;

/**
 * @param summary a videó témája (projektnév + átirat-részlet)
 * @returns {Promise<{hooks: {text: string, style: string}[]}>}
 */
async function runHookGenerator(summary) {
  return runStructured(HOOK_SYSTEM, `A VIDEÓ TÉMÁJA:\n${summary}`, HookReplySchema);
}

module.exports = {
  runAssistant,
  runAutoEdit,
  runCaptionStudio,
  runHookGenerator,
  runThumbHeadlines,
  aiAvailable,
  aiProvider,
  LOCAL_MODEL,
};
