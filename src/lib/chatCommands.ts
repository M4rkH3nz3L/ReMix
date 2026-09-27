import { normalizeText } from '@/lib/visionIndex';

/**
 * 💬 Chat → Creative Command Center (E-ChatCmd — MASTER §20) — a chat vezérelje a
 * workspace-t: „küldd el Annának a tegnapi projektet", „nyisd meg a projektet",
 * „készíts 30 mp-es verziót", „exportáld", „oszd meg a producerrel". Ez a TISZTA,
 * determinisztikus NL-parser: szöveg → strukturált parancs, amit a command bus
 * hajt végre (magyar + angol).
 */

export type ChatCommandType = 'open' | 'send' | 'version' | 'export' | 'share' | 'schedule' | 'search' | 'unknown';

export interface ChatCommand {
  type: ChatCommandType;
  /** címzett (send/share) — név/szerep */
  recipient?: string;
  /** rövid verzió hossza mp-ben (version) */
  seconds?: number;
  /** cél-platform (schedule) */
  platform?: string;
  /** relatív idő (yesterday/today/tomorrow/this-week) */
  when?: string;
  /** keresőkifejezés (search) */
  query?: string;
  raw: string;
}

const PLATFORMS = ['youtube', 'tiktok', 'instagram', 'spotify', 'podcast', 'blog', 'newsletter'];

/** relatív idő-kifejezés (normalizált szövegből). */
function detectWhen(norm: string): string | undefined {
  if (/\btegnap|\byesterday/.test(norm)) {
    return 'yesterday';
  }
  if (/\bholnap|\btomorrow/.test(norm)) {
    return 'tomorrow';
  }
  if (/\b(e heti|ezen a heten|this week)\b/.test(norm)) {
    return 'this-week';
  }
  if (/\bma\b|\btoday\b|\bmai\b/.test(norm)) {
    return 'today';
  }
  return undefined;
}

function detectPlatform(norm: string): string | undefined {
  return PLATFORMS.find((p) => norm.includes(p));
}

/** másodperc-hossz („30 mp", „30 másodperc", „30 sec", „30 second"). */
function detectSeconds(norm: string): number | undefined {
  const m = /(\d+)\s*(mp|masodperc|sec|second|seconds)\b/.exec(norm);
  return m ? parseInt(m[1], 10) : undefined;
}

/**
 * Címzett kinyerése (címzett-nélküli parancsnál undefined):
 *  • magyar rag: „Annának"/„producerrel" → tő,
 *  • angol: „to Anna"/„with the producer".
 * Az EREDETI (nem normalizált) szövegből dolgozik a kis/nagybetűért, de
 * kisbetűsítve adja vissza a stabilitásért.
 */
function detectRecipient(raw: string): string | undefined {
  // angol: to/with (the) X
  const en = /\b(?:to|with)\s+(?:the\s+)?([A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű]+)/i.exec(raw);
  if (en) {
    return en[1].toLowerCase();
  }
  // magyar ragozott név/szerep: <tő><nak|nek|hoz|hez|höz|val|vel|ral|rel|…>
  const hu = /\b([A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű]{2,}?)(nak|nek|hoz|hez|höz|val|vel|ral|rel|ról|ről|tól|től)\b/i.exec(raw);
  if (hu) {
    // a rag előtti tővégi nyújtott kötőhang visszaállítása (Anná→Anna, kezé→keze)
    return hu[1].toLowerCase().replace(/á$/, 'a').replace(/é$/, 'e');
  }
  return undefined;
}

/** A chat-üzenet strukturált workspace-paranccsá alakítása. */
export function parseChatCommand(text: string): ChatCommand {
  const raw = text.trim();
  const norm = normalizeText(raw);
  const base = (type: ChatCommandType, extra: Partial<ChatCommand> = {}): ChatCommand => ({ type, raw, ...extra });

  // sorrend: a specifikusabb minták előbb
  if (/(keszits|csinalj|make|create|generalj).*(verzio|version)|(\d+)\s*(mp|masodperc|sec|second)/.test(norm) && detectSeconds(norm)) {
    return base('version', { seconds: detectSeconds(norm) });
  }
  if (/\b(kuldd|kuld|send)\b/.test(norm)) {
    return base('send', { recipient: detectRecipient(raw), when: detectWhen(norm) });
  }
  if (/(oszd meg|megosztom|share)\b/.test(norm)) {
    return base('share', { recipient: detectRecipient(raw) });
  }
  if (/\b(utemezd|utemez|schedule|publikald|publish)\b/.test(norm)) {
    return base('schedule', { platform: detectPlatform(norm), when: detectWhen(norm) });
  }
  if (/\b(exportald|exportald|export|renderold|rendereld|render)\b/.test(norm)) {
    return base('export');
  }
  if (/\b(nyisd|nyiss|open)\b/.test(norm)) {
    return base('open');
  }
  if (/\b(keresd|keress|find|search|mutasd)\b/.test(norm)) {
    // a keresőszó a parancs-ige utáni rész
    const q = raw.replace(/^.*?(keresd|keress|find|search|mutasd)\s*/i, '').trim();
    return base('search', { query: q || undefined });
  }
  return base('unknown');
}
