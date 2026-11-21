// A provider-független strukturált hívás + az aiTokens-mérés (BYOK és lokális nem mért).
const { trackUsage, aiUsageContext } = require('../usage');
const { LOCAL_MODEL, remixAiQueue, remixAiConfig } = require('./config');
const { aiProvider } = require('./health');
const { runAnthropic, runLocal, runOpenAICompatible, openAiCompatCall } = require('./providers');

/**
 * Provider-független strukturált hívás — minden AI-funkció ezen megy át.
 * @param aiConfig opcionális BYOK-config (sanitizeAiConfig kimenete); ha van,
 *   a felhasználó saját modellje megy, különben a worker env-providere.
 */
async function runStructured(system, userContent, schema, aiConfig) {
  // 🔑 BYOK: a felhasználó SAJÁT kulcsa/végpontja → az ő költsége → NEM a mi
  // kvótánkba mérjük (ez a BYOK lényege).
  if (aiConfig) {
    const r =
      aiConfig.provider === 'anthropic'
        ? await runAnthropic(system, userContent, schema, aiConfig)
        : await runOpenAICompatible(system, userContent, schema, aiConfig);
    return r.data;
  }
  const provider = await aiProvider();
  if (provider === 'remix') {
    // 🧠 ReMix AI (Spark) = a MI költségünk → prioritásos sorban fut és meterelünk
    const store = aiUsageContext.getStore();
    const r = await remixAiQueue.run(store && store.tier, () => openAiCompatCall(system, userContent, schema, remixAiConfig()));
    if (store && store.uid && r.tokens > 0) {
      void trackUsage(store.uid, 'aiTokens', r.tokens);
    }
    return r.data;
  }
  if (provider === 'anthropic') {
    // ☁️ env Anthropic = a MI felhő-token-költségünk → meterelünk (valós usage).
    const r = await runAnthropic(system, userContent, schema);
    const store = aiUsageContext.getStore();
    if (store && store.uid && r.tokens > 0) {
      void trackUsage(store.uid, 'aiTokens', r.tokens);
    }
    return r.data;
  }
  if (provider === 'local') {
    // 🖥️ lokális Ollama = ingyenes (on-device-elvű) inferencia → NEM meterelünk.
    const r = await runLocal(system, userContent, schema);
    return r.data;
  }
  throw new Error(
    `Nincs elérhető AI: állíts be ANTHROPIC_API_KEY-t, indítsd el az Ollamát ` +
      `(ollama serve + ollama pull ${LOCAL_MODEL}), vagy állíts be saját AI-modellt a profilodban.`
  );
}

module.exports = { runStructured };
