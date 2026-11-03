#!/usr/bin/env node
// 📏 Mérési kapu a saját AI-hoz (PRO-CASH 7.3, C5.2): a DGX Sparkon futó OpenAI-kompatibilis
// szervert (vLLM / SGLang) méri valós ReMix-promptokkal 1, 4 és 8 párhuzamos kérésnél, majd a
// megadott költségekből önköltséget és árazási ítéletet számol, és Markdown-jegyzőkönyvet ír.
//
//   REMIX_AI_URL=http://spark:8000/v1 REMIX_AI_MODEL=… node scripts/spark-bench.js \
//     --watts 240 --kwh 0.32 --machine 3999 --network 15 --requests 8 --out ../devs/spark-meres.md
//
// Az áramfelvételt (W) terhelés alatt külső mérő adja (a Spark tápja); a szkript nem találgat.
const fs = require('fs');
const { summarizeRuns, costModel, reportMarkdown } = require('../sparkGate');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), [])
);
const URL_ = (process.env.REMIX_AI_URL || '').replace(/\/+$/, '');
const MODEL = process.env.REMIX_AI_MODEL || '';
const KEY = process.env.REMIX_AI_KEY || '';
if (!URL_ || !MODEL) {
  console.error('REMIX_AI_URL és REMIX_AI_MODEL kötelező.');
  process.exit(2);
}

// valós ReMix-feladatok (asszisztens, felirat-átírás, vágási terv) — rövid és hosszú kontextussal
const PROMPTS = [
  { system: 'Te a ReMix videószerkesztő asszisztense vagy. JSON-ban válaszolj: {"message": string, "commands": []}.', user: 'Legyen az első 5 másodperc pörgősebb, és tegyél feliratot a 2. klipre: „Kezdjük!”.' },
  { system: 'Írd át a feliratokat rövidebbre, magyarul. JSON: {"segments": [{"i": number, "text": string}]}.', user: JSON.stringify(Array.from({ length: 24 }, (_, i) => ({ i, text: `Ez a ${i + 1}. mondat egy hosszabb vlogból, ahol a beszélő a napjáról mesél és sok töltelékszót használ.` }))) },
  { system: 'Készíts vágási tervet. JSON: {"cuts": [{"start": number, "end": number, "reason": string}]}.', user: `Átirat (10 perc): ${'A beszélő elmagyarázza a recept lépéseit, közben szünetet tart. '.repeat(60)}` },
];

async function one(i) {
  const p = PROMPTS[i % PROMPTS.length];
  const t0 = Date.now();
  try {
    const res = await fetch(`${URL_}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(KEY ? { authorization: `Bearer ${KEY}` } : {}) },
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'system', content: p.system }, { role: 'user', content: p.user }], response_format: { type: 'json_object' }, temperature: 0.2 }),
    });
    const data = await res.json();
    return { ok: res.ok, ms: Date.now() - t0, completionTokens: data.usage?.completion_tokens || 0, totalTokens: data.usage?.total_tokens || 0 };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: String(e) };
  }
}

async function level(concurrency, requests) {
  const t0 = Date.now();
  const runs = [];
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < requests) {
      runs.push(await one(next++));
    }
  }));
  return summarizeRuns(runs, Date.now() - t0);
}

(async () => {
  const requests = Number(args.requests || 8);
  const levels = {};
  for (const c of String(args.levels || '1,4,8').split(',').map(Number)) {
    levels[c] = await level(c, Math.max(requests, c));
    console.log(`párhuzamos ${c}: ${levels[c].totalTokensPerSec.toFixed(1)} token/s, p95 ${levels[c].p95Ms} ms, hibás ${levels[c].failed}`);
  }
  const cost = {
    machineEur: Number(args.machine || 3999), months: Number(args.months || 36), watts: Number(args.watts || 0),
    kwhEur: Number(args.kwh || 0), networkEurMonth: Number(args.network || 0), utilization: Number(args.util || 0.6),
  };
  const result = costModel(levels, cost);
  const md = reportMarkdown({
    when: new Date().toISOString(), url: URL_, model: MODEL, levels, cost, result,
    quotas: { 'Amatőr': 200000, 'Haladó': 1000000, 'Profi': 3000000, 'Vállalati (fő)': 2000000 },
  });
  if (args.out) {
    fs.writeFileSync(args.out, md);
    console.log(`jegyzőkönyv: ${args.out}`);
  }
  console.log(`önköltség: ${result.costEurPer1M.toFixed(3)} € / 1 M token · árrés ${result.margin.toFixed(1)}× · ${result.pass ? 'MEGFELEL' : 'NEM FELEL MEG'}`);
  process.exit(levels[Object.keys(levels)[0]].failed === levels[Object.keys(levels)[0]].requests ? 1 : 0);
})();
