// 📏 Mérési kapu a saját AI árazásához (PRO-CASH 7.3, C5.2) — tiszta számoló.
//
// Az AI-token önköltségét nem becsüljük, hanem MÉRJÜK: token/s a valós promptokkal, 1 / 4 / 8
// párhuzamos kérésnél; az áramfelvételt (W) terhelés alatt külön mérőről adjuk meg.
//   önköltség / 1 M token = (amortizáció + áram + hálózat) / havi kiszolgálható token × 1 M
//   havi token = a legjobb párhuzamosság kimeneti token/s-e × 30 nap × kihasználtság (60%)
// A keret és az add-on ára akkor rendben, ha a bevétel legalább 3× az önköltség; ha nem,
// a KERET változik, nem az ár (7.3).

const SECONDS_PER_MONTH = 30 * 24 * 3600;

/** Egy párhuzamossági szint mérése: kimeneti token/s és késleltetés (p50 / p95). */
function summarizeRuns(runs, wallMs) {
  const ok = runs.filter((r) => r.ok);
  const lat = ok.map((r) => r.ms).sort((a, b) => a - b);
  const q = (p) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] : null);
  const outTokens = ok.reduce((n, r) => n + (r.completionTokens || 0), 0);
  const allTokens = ok.reduce((n, r) => n + (r.totalTokens || 0), 0);
  return {
    requests: runs.length,
    failed: runs.length - ok.length,
    outputTokensPerSec: wallMs > 0 ? (outTokens * 1000) / wallMs : 0,
    totalTokensPerSec: wallMs > 0 ? (allTokens * 1000) / wallMs : 0,
    p50Ms: q(0.5),
    p95Ms: q(0.95),
  };
}

/**
 * Önköltség és árazási ítélet. `levels`: { [párhuzamosság]: summarizeRuns(...) }.
 * `cost`: { machineEur, months (36), watts, kwhEur, networkEurMonth, utilization (0.6) }.
 * `price`: { addonEurPer1M (1 Coin = 5 €, bruttó), vatPct (27) } — a nettó bevételhez.
 */
function costModel(levels, cost, price = { addonEurPer1M: 5, vatPct: 27 }) {
  const best = Object.entries(levels).reduce((a, [c, s]) => (s.totalTokensPerSec > (a ? a.s.totalTokensPerSec : -1) ? { c: Number(c), s } : a), null);
  const tps = best ? best.s.totalTokensPerSec : 0;
  const util = cost.utilization ?? 0.6;
  const tokensPerMonth = tps * SECONDS_PER_MONTH * util;
  const amortEur = cost.machineEur / (cost.months || 36);
  const powerEur = ((cost.watts || 0) / 1000) * 24 * 30 * (cost.kwhEur || 0);
  const monthlyEur = amortEur + powerEur + (cost.networkEurMonth || 0);
  const costPer1M = tokensPerMonth > 0 ? (monthlyEur / tokensPerMonth) * 1e6 : Infinity;
  const netPer1M = price.addonEurPer1M / (1 + (price.vatPct ?? 27) / 100);
  const margin = costPer1M > 0 ? netPer1M / costPer1M : Infinity;
  return {
    bestConcurrency: best ? best.c : null,
    tokensPerSec: tps,
    tokensPerMonth,
    monthlyEur: { amortization: amortEur, power: powerEur, network: cost.networkEurMonth || 0, total: monthlyEur },
    costEurPer1M: costPer1M,
    netRevenueEurPer1M: netPer1M,
    margin,
    // 7.3: a bevétel ≥ 3× önköltség; ha nem, a keretet csökkentjük (az ár marad)
    pass: margin >= 3,
    // ennyi tokent bír a gép havonta egy fizetős szint keretéhez (60%-os kihasználtság mellett)
    maxSubscribersAtQuota: (quotaTokens) => (quotaTokens > 0 ? Math.floor(tokensPerMonth / quotaTokens) : Infinity),
  };
}

/** A jegyzőkönyv Markdownban (a devs/-be mentendő, C5.2 elfogadás). */
function reportMarkdown({ when, url, model, levels, model: _m, cost, result, quotas }) {
  const n = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d).replace('.', ',') : '—');
  const rows = Object.entries(levels)
    .map(([c, s]) => `| ${c} | ${s.requests} | ${s.failed} | ${n(s.outputTokensPerSec)} | ${n(s.totalTokensPerSec)} | ${s.p50Ms ?? '—'} | ${s.p95Ms ?? '—'} |`)
    .join('\n');
  const q = Object.entries(quotas || {})
    .map(([tier, tok]) => `| ${tier} | ${tok.toLocaleString('hu-HU')} | ${result.maxSubscribersAtQuota(tok)} |`)
    .join('\n');
  return `# Mérési jegyzőkönyv — saját AI (PRO-CASH 7.3)

- Időpont: ${when}
- Végpont: ${url} · modell: \`${model}\`

## Áteresztés

| Párhuzamos | Kérés | Hibás | Kimeneti token/s | Összes token/s | p50 (ms) | p95 (ms) |
|---|---|---|---|---|---|---|
${rows}

## Önköltség

| Tétel | € / hó |
|---|---|
| Amortizáció (${n(cost.machineEur, 0)} € / ${cost.months || 36} hó) | ${n(result.monthlyEur.amortization, 2)} |
| Áram (${cost.watts} W × ${n(cost.kwhEur, 3)} € / kWh) | ${n(result.monthlyEur.power, 2)} |
| Hálózat | ${n(result.monthlyEur.network, 2)} |
| **Összesen** | **${n(result.monthlyEur.total, 2)}** |

- Legjobb párhuzamosság: ${result.bestConcurrency} · havi kiszolgálható token (${Math.round((cost.utilization ?? 0.6) * 100)}%): ${Math.round(result.tokensPerMonth).toLocaleString('hu-HU')}
- **Önköltség / 1 M token: ${n(result.costEurPer1M, 3)} €** · nettó bevétel / 1 M (add-on): ${n(result.netRevenueEurPer1M, 2)} €
- Árrés: **${n(result.margin, 1)}×** → ${result.pass ? '✅ megfelel (≥ 3×)' : '❌ nem felel meg — a keretet csökkenteni kell (7.3)'}

## Kapacitás a szintenkénti keretekkel

| Szint | Token / hó | Ennyi előfizetőt bír ki a gép |
|---|---|---|
${q}
`;
}

module.exports = { summarizeRuns, costModel, reportMarkdown, SECONDS_PER_MONTH };
