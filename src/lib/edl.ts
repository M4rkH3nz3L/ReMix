import { formatTimecode } from '@/lib/frames';

/**
 * 🎬 EDL-export (S-VIDEO NLE, audit ★) — CMX3600-stílusú vágólista más NLE-knek
 * (Resolve/Premiere/Avid). Tiszta, expo-mentes szöveg-generátor; a timecode a
 * projekt frame-rátájából ([frames.ts](./frames) `formatTimecode`) számol.
 */

export interface EdlEvent {
  /** forrás-„reel" (tekercs) azonosító; alap: AX */
  reel?: string;
  /** V = videó, A = hang */
  track?: 'V' | 'A';
  /** forrás-be/ki (mp) */
  srcInSec: number;
  srcOutSec: number;
  /** record-be/ki az idővonalon (mp) */
  recInSec: number;
  recOutSec: number;
  /** opcionális klip-név (megjegyzésként) */
  name?: string;
}

/** Egyszerű idővonal-klipek → EDL-események (egymás után a rekordon). */
export function clipsToEdlEvents(
  clips: { start: number; duration: number; trimIn?: number; reel?: string; name?: string }[]
): EdlEvent[] {
  return clips.map((c) => {
    const srcIn = c.trimIn ?? 0;
    return {
      reel: c.reel ?? 'AX',
      track: 'V',
      srcInSec: srcIn,
      srcOutSec: srcIn + c.duration,
      recInSec: c.start,
      recOutSec: c.start + c.duration,
      ...(c.name ? { name: c.name } : {}),
    };
  });
}

const pad3 = (n: number): string => String(n).padStart(3, '0');

/** CMX3600 EDL-szöveg az eseményekből (a `fps` a timecode-hoz). */
export function buildEdl(title: string, events: EdlEvent[], fps: number): string {
  const lines: string[] = [`TITLE: ${title.trim() || 'ReMix Export'}`, 'FCM: NON-DROP FRAME'];
  events.forEach((e, i) => {
    const reel = (e.reel ?? 'AX').padEnd(8).slice(0, 8);
    const track = e.track ?? 'V';
    const tc = (s: number) => formatTimecode(s, fps);
    lines.push(
      `${pad3(i + 1)}  ${reel} ${track}     C        ${tc(e.srcInSec)} ${tc(e.srcOutSec)} ${tc(e.recInSec)} ${tc(e.recOutSec)}`
    );
    if (e.name) {
      lines.push(`* FROM CLIP NAME: ${e.name}`);
    }
  });
  return lines.join('\n');
}
