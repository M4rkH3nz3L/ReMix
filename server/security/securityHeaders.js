// 🧢 Security-fejlécek (devs/tasks/remix/14) — helmet-szerű alap, ÚJ DEP NÉLKÜL.
//
// Minden worker-válasz megkapja a biztonsági alap-fejléceket. SZÁNDÉKOSAN NEM
// állítunk olyat, ami a média-kiszolgálást törné (pl. Cross-Origin-Resource-
// Policy: same-origin elvágná a feed cross-origin videóit) — csak a széles körben
// biztonságos, funkció-semleges fejlécek.

/**
 * @returns Express-middleware, ami beállítja a biztonsági fejléceket.
 */
function securityHeaders() {
  return (req, res, next) => {
    // a válasz típusát ne „találgassa" a böngésző (MIME-sniffing támadások ellen)
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // ne lehessen iframe-be ágyazni (clickjacking)
    res.setHeader('X-Frame-Options', 'DENY');
    // ne szivárogjon a teljes Referer más originre
    res.setHeader('Referrer-Policy', 'no-referrer');
    // ne prefetcheljen DNS-t a tartalom alapján
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    // Flash/PDF cross-domain policy tiltása
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    // HSTS: a böngésző HTTP-n figyelmen kívül hagyja, HTTPS-en kényszeríti a TLS-t
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
    // az Express verzió-ujjlenyomatát ne szivárogtassuk
    res.removeHeader('X-Powered-By');
    next();
  };
}

module.exports = { securityHeaders };
