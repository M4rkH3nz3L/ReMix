// 🛡️ Worker-oldali hálózati hardening (08-storage §2.1) — időkorlát + újrapróbálás a
// külső provider-hívásokhoz (Drive/Dropbox/WebDAV/S3). NINCS függő kérés (AbortController),
// és az ÁTMENETI hibák (hálózat/408/425/429/5xx) IDEMPOTENS kérésnél újrapróbálódnak,
// exponenciális backoffal. A nem-idempotens (token-csere, feltöltés) CSAK időkorlátot kap.
// A fetch + sleep injektálható → tesztelhető valódi hálózat/idő nélkül.

/** Átmeneti (újrapróbálható) HTTP-státusz? */
function isTransientStatus(status) {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status < 600);
}

/** fetch időkorláttal — a timer mindig elpakolódik (nincs leak). */
async function fetchWithTimeout(url, init = {}, timeoutMs = 15000, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * fetch időkorláttal + újrapróbálással. Újrapróbál, ha IDEMPOTENS a kérés (GET/HEAD,
 * vagy `opts.idempotent === true`) ÉS a hiba átmeneti (dobás, vagy transient-státusz).
 * A nem-idempotens kérés egyszer fut (csak időkorlát). Az utolsó próbát visszaadja/dobja.
 */
async function fetchRetry(url, init = {}, opts = {}) {
  const {
    timeoutMs = 15000,
    attempts = 3,
    baseDelayMs = 400,
    fetchImpl = fetch,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = opts;
  const method = (init.method || 'GET').toUpperCase();
  const idempotent = opts.idempotent ?? (method === 'GET' || method === 'HEAD');
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    const last = i >= attempts - 1;
    try {
      const res = await fetchWithTimeout(url, init, timeoutMs, fetchImpl);
      if (idempotent && !last && isTransientStatus(res.status)) {
        await sleep(baseDelayMs * 2 ** i);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (!idempotent || last) {
        throw err;
      }
      await sleep(baseDelayMs * 2 ** i);
    }
  }
  throw lastErr;
}

module.exports = { isTransientStatus, fetchWithTimeout, fetchRetry };
