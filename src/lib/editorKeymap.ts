/**
 * ⌨️ A szerkesztő EGYSÉGES billentyű-parancskészlete (EDITOR-UX §2.7).
 *
 * Ez a mag SZÁNDÉKOSAN pure + store-mentes: egy billentyű-eseményből (web /
 * tablet-billentyűzet) egy SZEMANTIKUS akciót old fel. A tényleges store-hívást
 * a vékony bekötő réteg végzi (`bindEditorShortcut`), hogy a leképezés
 * önmagában tesztelhető legyen — ugyanaz a minta, mint a többi `src/lib/` magnál.
 *
 * A készlet a szakmai vágó-konvenciót követi: space = lejátszás, J-K-L = jog,
 * I/O = be/ki-pont, S = vágás, ⌫ = törlés, ⌘/Ctrl+Z/⇧Z = undo/redo,
 * ⌘/Ctrl+C/X/V = klip-vágólap, ←/→ = frame-léptetés.
 */

export type EditorShortcut =
  | 'playPause' // Space
  | 'frameBack' // ←
  | 'frameForward' // →
  | 'jogBack' // J
  | 'stop' // K
  | 'jogForward' // L
  | 'setIn' // I
  | 'setOut' // O
  | 'split' // S
  | 'delete' // ⌫ / Delete
  | 'undo' // ⌘/Ctrl+Z
  | 'redo' // ⇧⌘/Ctrl+Z, Ctrl+Y
  | 'copy' // ⌘/Ctrl+C
  | 'cut' // ⌘/Ctrl+X
  | 'paste'; // ⌘/Ctrl+V

/** A DOM `KeyboardEvent` részhalmaza — így a mag nem függ a böngészőtől/RN-től. */
export interface KeyEventLike {
  /** A `KeyboardEvent.key` (pl. ` `, `ArrowLeft`, `j`, `Backspace`). */
  key: string;
  /** ⌘ (macOS). */
  metaKey?: boolean;
  /** Ctrl (Windows/Linux). */
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  /**
   * Igaz, ha a fókusz szövegmezőn/szerkeszthető elemen van — ekkor a gépelést
   * NEM raboljuk el (a hívó deríti ki a `target`-ből).
   */
  inTextInput?: boolean;
}

/** A ⌘ (mac) és a Ctrl (win/linux) ugyanazt a „parancs"-modifikátort jelenti. */
function hasCommandModifier(e: KeyEventLike): boolean {
  return Boolean(e.metaKey || e.ctrlKey);
}

/**
 * Egy billentyű-eseményből a hozzá tartozó szerkesztő-akció, vagy `null`, ha a
 * billentyű nincs lekötve (a hívó ilyenkor NE `preventDefault`-oljon).
 */
export function resolveShortcut(e: KeyEventLike): EditorShortcut | null {
  // Gépelés közben (szövegmező) soha nem kapunk el billentyűt.
  if (e.inTextInput) {
    return null;
  }

  const command = hasCommandModifier(e);
  // Minden kulcsot kisbetűsre: a betűk ('J'→'j') és a nevesített kulcsok
  // ('ArrowLeft'→'arrowleft', 'Backspace'→'backspace') is egységesek legyenek.
  const key = e.key.toLowerCase();

  // ⌘/Ctrl-kombók: undo/redo + klip-vágólap.
  if (command) {
    switch (key) {
      case 'z':
        return e.shiftKey ? 'redo' : 'undo';
      case 'y':
        return 'redo'; // Windows-konvenció
      case 'c':
        return 'copy';
      case 'x':
        return 'cut';
      case 'v':
        return 'paste';
      default:
        return null;
    }
  }

  // Alt-kombókat nem foglalunk le (rendszer/ékezet-bevitel).
  if (e.altKey) {
    return null;
  }

  // Modifikátor nélküli egygombos parancsok.
  switch (key) {
    case ' ':
    case 'spacebar': // néhány régi böngésző
      return 'playPause';
    case 'arrowleft':
      return 'frameBack';
    case 'arrowright':
      return 'frameForward';
    case 'j':
      return 'jogBack';
    case 'k':
      return 'stop';
    case 'l':
      return 'jogForward';
    case 'i':
      return 'setIn';
    case 'o':
      return 'setOut';
    case 's':
      return 'split';
    case 'backspace':
    case 'delete':
      return 'delete';
    default:
      return null;
  }
}

/** Megjelenítendő billentyű-címke egy akcióhoz (help-overlay + felfedezhetőség). */
export const SHORTCUT_HINTS: { action: EditorShortcut; keys: string }[] = [
  { action: 'playPause', keys: 'Space' },
  { action: 'jogBack', keys: 'J' },
  { action: 'stop', keys: 'K' },
  { action: 'jogForward', keys: 'L' },
  { action: 'frameBack', keys: '←' },
  { action: 'frameForward', keys: '→' },
  { action: 'setIn', keys: 'I' },
  { action: 'setOut', keys: 'O' },
  { action: 'split', keys: 'S' },
  { action: 'delete', keys: '⌫' },
  { action: 'undo', keys: '⌘/Ctrl+Z' },
  { action: 'redo', keys: '⇧⌘/Ctrl+Z' },
  { action: 'copy', keys: '⌘/Ctrl+C' },
  { action: 'cut', keys: '⌘/Ctrl+X' },
  { action: 'paste', keys: '⌘/Ctrl+V' },
];
