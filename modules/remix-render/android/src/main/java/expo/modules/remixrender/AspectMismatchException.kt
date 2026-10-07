package expo.modules.remixrender

/**
 * A remux (Fázis A) nem alkalmazható, mert a klip képaránya eltér a vászonétól →
 * skálázás kell. A modul ezt elkapva a [TranscodeEngine]-re (Fázis B) vált.
 */
class AspectMismatchException(message: String) : Exception(message)
