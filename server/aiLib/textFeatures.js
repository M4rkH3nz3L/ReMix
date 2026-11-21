// Szöveges AI-funkciók: Caption Studio (kiemelés + emoji), borítókép-címek, hookok, felirat-fordítás.
const { z } = require('zod');
const { runStructured } = require('./runStructured');

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
async function runCaptionStudio(segments, aiConfig) {
  return runStructured(
    CAPTION_STUDIO_SYSTEM,
    `SZEGMENSEK:\n${JSON.stringify(segments, null, 1)}`,
    CaptionStudioReplySchema,
    aiConfig
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
async function runThumbHeadlines(summary, aiConfig) {
  return runStructured(THUMB_SYSTEM, `TÉMA/ÁTIRAT:\n${summary}`, ThumbHeadlineSchema, aiConfig);
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
async function runHookGenerator(summary, aiConfig) {
  return runStructured(HOOK_SYSTEM, `A VIDEÓ TÉMÁJA:\n${summary}`, HookReplySchema, aiConfig);
}

// --- 🌍 Felirat-fordítás / lokalizáció (Phase 4.2) --------------------------

const TranslateReplySchema = z.object({
  segments: z.array(z.object({ id: z.string(), text: z.string() })),
});

const TRANSLATE_SYSTEM = `Feliratszövegeket fordítasz egy videószerkesztőben. A
bemenet felirat-szegmensek (id + text). Fordítsd le MINDEGYIK "text"-et a kért
CÉLNYELVRE.

Szabályok:
- Természetes, TÖMÖR feliratszöveg — a hosszt nagyjából tartsd (feliratba fér).
- Az "id"-t VÁLTOZATLANUL add vissza minden szegmensnél; MINDEN bemeneti
  szegmensre adj egy kimenetit.
- Tulajdonneveket, márkákat, hashtageket, @említéseket NE fordíts.
- A választ CSAK a séma szerinti JSON-ban add.`;

/**
 * @param segments [{id, text}] felirat-szegmensek
 * @param lang cél-nyelv neve (pl. "English", "Deutsch")
 * @returns {Promise<{segments: [{id, text}]}>}
 */
async function runTranslateCaptions(segments, lang, aiConfig) {
  return runStructured(
    TRANSLATE_SYSTEM,
    `CÉLNYELV: ${lang}\n\nSZEGMENSEK:\n${JSON.stringify(segments, null, 1)}`,
    TranslateReplySchema,
    aiConfig
  );
}

module.exports = { runCaptionStudio, runThumbHeadlines, runHookGenerator, runTranslateCaptions };
