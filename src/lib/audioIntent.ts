/**
 * 🎙️🤖 Hang-asszisztens az eszközön (pure): magyar és angol mondatból ellenőrzött parancslista a
 * command buson. Szabály-alapú, nem nyelvi modell: offline, azonnali, iOS-en és Androidon is.
 * Amit nem ért, azt nem találgatja, hanem `unknown`-ként visszaadja. Egy későbbi helyi vagy
 * szerveres modell ugyanerre a lépés-listára fordíthat.
 */
// A megvalósítás a `src/lib/intent/audio/` modulcsaládban él; ez a fájl a publikus felület (barrel).

export type { AudioStep, AudioAction, AudioIntentResult, AudioIntentContext } from '@/lib/intent/audio/types';
export { splitClauses } from '@/lib/intent/audio/text';
export { numberWordsToDigits, fixDictation, ASR_HINT } from '@/lib/intent/audio/dictation';
export { parseAudioIntent, intentCommands } from '@/lib/intent/audio/parse';
