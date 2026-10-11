import de from './locales/de.json';
import en from './locales/en.json';
import hu from './locales/hu.json';

// 🔤 Hang-stúdió i18n LOCALE-PARITY (AUDIO-STUDIO-PROD §7).
//
// A hang-UI kulcsai több névtérben élnek (studio.audio, studio.audioTools, panels.audio).
// Ez a teszt zárolja, hogy MINDEN logikai kulcs MINDHÁROM nyelvben (hu/en/de) létezik —
// különben egy felhasználó üres/angol feliratot látna a saját nyelvén. A legacy
// `hangStudio.*` névteret kivezettük (studio.audio.* alá) → ennek is tiltva kell lennie.

type Dict = Record<string, unknown>;
const LOCALES: Record<string, Dict> = { en: en as Dict, hu: hu as Dict, de: de as Dict };
const AUDIO_NAMESPACES = [
  ['studio', 'audio'],
  ['studio', 'audioTools'],
  ['panels', 'audio'],
];

function at(root: Dict, pathParts: string[]): Dict | undefined {
  let cur: unknown = root;
  for (const p of pathParts) {
    if (cur && typeof cur === 'object' && p in (cur as Dict)) {
      cur = (cur as Dict)[p];
    } else {
      return undefined;
    }
  }
  return cur && typeof cur === 'object' ? (cur as Dict) : undefined;
}

/** levél-kulcsok pont-útként; a plural-suffixeket (_one/_other/…) a bázisra normalizálja */
function leafKeys(obj: Dict, prefix = ''): Set<string> {
  const out = new Set<string>();
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const leaf of leafKeys(v as Dict, key)) {
        out.add(leaf);
      }
    } else {
      out.add(key.replace(/_(one|other|zero|two|few|many)$/, ''));
    }
  }
  return out;
}

describe('i18n audio locale-parity (hu/en/de)', () => {
  test('a legacy hangStudio névtér KI van vezetve (egyik nyelvben sincs)', () => {
    for (const [loc, root] of Object.entries(LOCALES)) {
      expect({ loc, hasHangStudio: 'hangStudio' in root }).toEqual({ loc, hasHangStudio: false });
    }
  });

  test('a migrált kulcsok a studio.audio alatt vannak mindhárom nyelven', () => {
    const migrated = ['title', 'volume', 'fadeIn', 'fadeOut', 'enhance', 'deReverb', 'autoDuck', 'enhanceHint'];
    for (const [loc, root] of Object.entries(LOCALES)) {
      const sa = at(root, ['studio', 'audio']) ?? {};
      for (const k of migrated) {
        expect({ loc, key: k, present: k in sa }).toEqual({ loc, key: k, present: true });
      }
    }
  });

  for (const ns of AUDIO_NAMESPACES) {
    const nsName = ns.join('.');
    test(`${nsName}: azonos kulcs-halmaz mindhárom nyelven`, () => {
      const enKeys = leafKeys(at(en as Dict, ns) ?? {});
      expect(enKeys.size).toBeGreaterThan(0); // a névtér létezik + nem üres
      for (const loc of ['hu', 'de']) {
        const locKeys = leafKeys(at(LOCALES[loc], ns) ?? {});
        const missingInLoc = [...enKeys].filter((k) => !locKeys.has(k));
        const extraInLoc = [...locKeys].filter((k) => !enKeys.has(k));
        expect({ ns: nsName, loc, missingInLoc, extraInLoc }).toEqual({ ns: nsName, loc, missingInLoc: [], extraInLoc: [] });
      }
    });
  }
});
