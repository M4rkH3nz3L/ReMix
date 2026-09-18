/**
 * 📜 Jogi szövegek — Adatkezelési tájékoztató (GDPR) + Felhasználási feltételek.
 *
 * ⚠️ SABLON: ezt a szöveget JOGI FELÜLVIZSGÁLAT után kell élesíteni (az adatkezelő
 * neve/címe, a tárhely-szolgáltatók, a megőrzési idők a tényleges üzemre szabva).
 * A `CONSENT_VERSION`-t módosítsd, ha a tájékoztató érdemben változik → a
 * felhasználóktól újra-hozzájárulás kérhető (a user_consents naplózza).
 */

/** A jelenlegi tájékoztató-verzió (dátum-alapú). Változáskor emeld. */
export const CONSENT_VERSION = '2026-09-18';

export type LegalDoc = 'privacy' | 'terms';

export const PRIVACY_POLICY = `ADATKEZELÉSI TÁJÉKOZTATÓ (GDPR)
Verzió: ${CONSENT_VERSION}

⚠️ Ez sablon — éles használat előtt jogi felülvizsgálat szükséges.

1. ADATKEZELŐ
A ReMix alkalmazás üzemeltetője. (Töltsd ki: cégnév, székhely, e-mail.)

2. MILYEN ADATOKAT KEZELÜNK
• Fiókadatok: e-mail-cím, teljes név, telefonszám, születési dátum, ország, város.
• Tartalom: az általad létrehozott projektek, közzétett videók/posztok, kommentek,
  kedvelések, mentések, követések, és a feltöltött médiafájlok.
• Technikai adatok: eszköz-adatok (modell, OS, felbontás), a szolgáltatás
  működéséhez szükséges naplók.
• Előfizetés: a Pro-státusz és a vásárlás-azonosítók (a fizetést a RevenueCat/
  az áruház kezeli — bankkártya-adatot NEM tárolunk).

3. AZ ADATKEZELÉS CÉLJA ÉS JOGALAPJA
• A szolgáltatás nyújtása (szerződés teljesítése, GDPR 6. cikk (1) b).
• A közösségi funkciók (feed, remix, kommentek) működtetése.
• Jogi kötelezettség teljesítése és jogos érdek (biztonság, visszaélés-megelőzés).
• Hozzájárulás alapján (GDPR 6. cikk (1) a) — regisztrációkor rögzítve.

4. TÁROLÁS ÉS MEGŐRZÉS
Az adatokat a Supabase (adatbázis/hitelesítés) és S3-kompatibilis tárhely
(médiafájlok) szolgáltatókon tároljuk. Az adatokat a fiók fennállásáig, illetve
a jogszabályi kötelezettségekig őrizzük; a fiók törlésekor véglegesen töröljük
(lásd 6. pont).

5. ADATTOVÁBBÍTÁS
Csak a szolgáltatás működéséhez szükséges feldolgozóknak (tárhely, push-értesítés,
fizetés). Harmadik félnek marketing célból NEM adjuk át.

6. A TE JOGAID (GDPR III. fejezet)
• Hozzáférés és hordozhatóság: kérheted a rólad tárolt adatok másolatát.
• Helyesbítés: a profil-adatok bármikor módosíthatók.
• Törléshez való jog („elfeledtetés"): a fiók és minden tartalmad véglegesen
  törölhető.
• Korlátozás és tiltakozás: kérheted az adatkezelés korlátozását.
• Hozzájárulás visszavonása: a jövőre nézve bármikor.
• Panasz: a felügyeleti hatóságnál (Magyarországon: NAIH, naih.hu).

7. KAPCSOLAT
Adatvédelmi kérdésekben: (töltsd ki: adatvédelmi e-mail-cím).`;

export const TERMS = `FELHASZNÁLÁSI FELTÉTELEK
Verzió: ${CONSENT_VERSION}

⚠️ Ez sablon — éles használat előtt jogi felülvizsgálat szükséges.

1. A SZOLGÁLTATÁS
A ReMix egy interaktív videószerkesztő és közösségi platform. A regisztrációval
elfogadod ezeket a feltételeket és az Adatkezelési tájékoztatót.

2. A TE TARTALMAD
A feltöltött és létrehozott tartalom a tiéd marad. A közzététellel (feed) engedélyt
adsz arra, hogy más felhasználók a platformon megtekintsék és — ha engedélyezed —
remixeljék. A remix a te tartalmad egy pillanatképéből készül, önálló művként.

3. ELFOGADHATÓ HASZNÁLAT
Tilos jogsértő, gyűlölködő, zaklató vagy mások jogait sértő tartalom közzététele.
A szabályt sértő tartalom moderálható/eltávolítható.

4. MODERÁCIÓ
A tartalom-tulajdonos a saját tartalmához tartozó kommenteket/remixeket kezelheti;
a platform-moderátorok jogsértő tartalmat eltávolíthatnak.

5. FELELŐSSÉG
A szolgáltatás „ahogy van" alapon érhető el. (A részletes felelősség-korlátozást
jogi felülvizsgálat után kell véglegesíteni.)

6. FIÓK MEGSZŰNÉSE
A fiókodat bármikor törölheted; ekkor a tartalmad véglegesen törlődik.`;

export function legalText(doc: LegalDoc): string {
  return doc === 'terms' ? TERMS : PRIVACY_POLICY;
}
