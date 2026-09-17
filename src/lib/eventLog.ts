import type { EditorCommand } from '@/lib/commands';
import type { Clip } from '@/types/project';

/**
 * 📉 Az eseménynaplóba szánt, KÖNNYÍTETT command.
 *
 * A napló (`ProjectEvent[]`, max 300 bejegyzés) NEM az undo-verem — az a `past`/
 * `future` teljes projekt-pillanatképeiben él. A naplót kizárólag a
 * `describeCommand()` olvassa: az Előzmények-modal és az AI-kontextus
 * (`recentActions`) egy-egy ember-olvasható MONDATOT csinál belőle. Vissza-
 * játszás sehol nincs.
 *
 * Mégis a TELJES klip-tömbök kerültek bele. Mérés 100 klipes projekten:
 *   egy klip .................. 0,4 KB
 *   egy REPLACE_TRACKS ........ 40 KB
 *   vegyes napló (10% nehéz) .. 1,2 MB  ← EZT írja újra MINDEN autosave
 *   csupa nehéz napló ......... 11,7 MB ← az Android 2 MB/kulcs limit fölött
 *
 * Ezért a nehéz mezőket a naplózás előtt lecsupaszítjuk. Nem KIÜRÍTJÜK őket:
 * a `describeCommand` DARABSZÁMOKAT ír ki („12 klip cserélve"), egy üres tömb
 * tehát hamis naplót adna. Minden klip helyére egy `{ id, kind }` csonk kerül —
 * a darabszám és az azonosítók megmaradnak, a súly elmegy.
 *
 * ⚠️ A csonkolt command NEM alkalmazható (`applyCommand`) — hiányoznak a mezői.
 * Ezért kap az esemény `slim: true` jelölést: ha valaha valaki vissza akarná
 * játszani a naplót, az a jelölésen azonnal elhasal, nem néma adatvesztésként.
 *
 * Ha a `describeCommand` új mezőt kezd használni, ITT is meg kell tartani —
 * a két függvény párban jár.
 */

/** egy klip helyett ennyi marad: azonosítható, de súlytalan */
function stub(clip: Clip): Clip {
  return { id: clip.id, kind: clip.kind } as Clip;
}

const stubs = (clips: Clip[]): Clip[] => clips.map(stub);

/** Igaz, ha a command egyáltalán hordoz nehéz adatot (különben felesleges másolni). */
export function isHeavyCommand(cmd: EditorCommand): boolean {
  return (
    cmd.type === 'REPLACE_TRACKS' ||
    cmd.type === 'REPLACE_TRACK_CLIPS' ||
    cmd.type === 'ADD_CLIPS' ||
    cmd.type === 'ADD_CLIP' ||
    cmd.type === 'UPSERT_IMAGE_DOC'
  );
}

/**
 * A naplóba írandó változat. A könnyű commandokat VÁLTOZATLANUL adja vissza
 * (ugyanaz a referencia — nincs fölösleges másolás a forró úton).
 */
export function slimForLog(cmd: EditorCommand): EditorCommand {
  switch (cmd.type) {
    case 'REPLACE_TRACKS':
      // az `assets` mezőt a leírás nem használja → teljesen elhagyható
      return {
        type: 'REPLACE_TRACKS',
        tracks: cmd.tracks.map((t) => ({ trackType: t.trackType, clips: stubs(t.clips) })),
        ...(cmd.label === undefined ? {} : { label: cmd.label }),
      };
    case 'REPLACE_TRACK_CLIPS':
      return { type: 'REPLACE_TRACK_CLIPS', trackType: cmd.trackType, clips: stubs(cmd.clips) };
    case 'ADD_CLIPS':
      return { type: 'ADD_CLIPS', trackType: cmd.trackType, clips: stubs(cmd.clips) } as EditorCommand;
    case 'ADD_CLIP':
      // a leírás csak a `kind`-ot kéri, de EGY klip súlya elhanyagolható, és a
      // `trackType` is kell — csak a klipet csonkoljuk
      return { ...cmd, clip: stub(cmd.clip) } as EditorCommand;
    case 'UPSERT_IMAGE_DOC':
      // a rétegek maszkokat/útvonalakat hordoznak — a leírásnak a NÉV és a
      // rétegszám elég, ezért a rétegek is csonkká válnak
      return {
        ...cmd,
        doc: {
          ...cmd.doc,
          layers: cmd.doc.layers.map((l) => ({ id: l.id, kind: l.kind })),
        },
      } as EditorCommand;
    default:
      return cmd;
  }
}
