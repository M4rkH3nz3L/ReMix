package expo.modules.remixrender

/**
 * A render-t a hívó (JS `AbortSignal` → `cancel()`) megszakította. A motor-loopok
 * ezt dobják, a részfájlt a `catch` törli → a kimenet nem kerül megosztásra/Fotókba.
 */
class RenderCancelledException : Exception("A render megszakítva.")
