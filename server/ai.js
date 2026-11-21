// AI-asszisztens (full-plan F3): a kliens rétegzett projekt-kontextust küld,
// a modell egy szigorú parancs-whitelistből ad vissza műveleteket (structured
// output), amit a kliens validál és a Command Bus-on hajt végre. Az AI sosem
// írja közvetlenül a projektet.
//
// A modulcsalád a server/aiLib/ alatt: config (modellek, env, ReMix AI sor), providers
// (Anthropic / lokális / OpenAI-kompatibilis hívás), health (elérhetőség, provider-választás),
// byok (saját kulcs: config-szűrés, próba), runStructured (közös hívás + aiTokens-mérés),
// assistant / editFeatures / textFeatures (a funkciók sémái és promptjai).
const { LOCAL_MODEL } = require('./aiLib/config');
const { aiAvailable, aiProvider, remixStatus } = require('./aiLib/health');
const { sanitizeAiConfig, probeProvider } = require('./aiLib/byok');
const { runStructured } = require('./aiLib/runStructured');
const { runAssistant } = require('./aiLib/assistant');
const { runAutoEdit, runStoryEngine, runHighlights } = require('./aiLib/editFeatures');
const { runCaptionStudio, runThumbHeadlines, runHookGenerator, runTranslateCaptions } = require('./aiLib/textFeatures');

module.exports = {
  probeProvider,
  runAssistant,
  runAutoEdit,
  runCaptionStudio,
  runHighlights,
  runHookGenerator,
  runStoryEngine,
  runThumbHeadlines,
  runTranslateCaptions,
  sanitizeAiConfig,
  aiAvailable,
  aiProvider,
  remixStatus,
  runStructured,
  LOCAL_MODEL,
};
