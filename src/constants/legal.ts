/**
 * 📜 Jogi szövegek — Adatkezelési tájékoztató (GDPR) + Felhasználási feltételek.
 *
 * Ez a VÉGLEGESÍTETT változat: a tartalom a ReMix TÉNYLEGES működésére épül
 * (adatfeldolgozók, adatkategóriák, jogalapok, a megvalósított jogok). EGYETLEN
 * kitöltendő rész maradt: az ADATKEZELŐ azonossága (a «...» jelölt mezők) — ezt a
 * tényleges cég/magánszemély adataival kell pótolni, mert jogilag csak Te tudod.
 *
 * A `CONSENT_VERSION`-t emeltem (a szöveg érdemben változott) → az új
 * regisztrációk ezt a verziót rögzítik a user_consents naplóba. Élesítés előtt
 * ajánlott egy jogi átnézés a joghatóság-specifikus záradékokhoz.
 */

/** A jelenlegi tájékoztató-verzió. Változáskor emeld (→ újra-hozzájárulás kérhető). */
export const CONSENT_VERSION = '2026-09-18.2';

/** Utolsó tartalmi frissítés (a szövegben megjelenik). */
export const LEGAL_UPDATED = '2026. szeptember 18.';

export type LegalDoc = 'privacy' | 'terms';

export const PRIVACY_POLICY = `ADATKEZELÉSI TÁJÉKOZTATÓ
ReMix — interaktív videószerkesztő és közösségi platform
Verzió: ${CONSENT_VERSION} · Utolsó frissítés: ${LEGAL_UPDATED}

Ez a tájékoztató azt írja le, hogy a ReMix milyen személyes adatokat kezel, milyen
célból és jogalapon, kikkel osztja meg, meddig tárolja, és milyen jogaid vannak
(EU 2016/679 rendelet — GDPR).

1. AZ ADATKEZELŐ
Név: «ADATKEZELŐ NEVE (cég vagy magánszemély)»
Székhely / cím: «SZÉKHELY / ORSZÁG»
Adatvédelmi kapcsolat: «ADATVÉDELMI E-MAIL»
(Ha az adatkezelő cég, a nyilvántartási/adószám is ide kerül.)

2. MILYEN ADATOKAT KEZELÜNK
a) Fiók- és profiladatok: e-mail-cím (a bejelentkezéshez), teljes név, telefonszám,
   születési dátum, ország, város.
b) Az általad létrehozott TARTALOM: projektek (a szerkesztési terv), közzétett
   videók/posztok, a hozzájuk tartozó feltöltött médiafájlok (videó, borítókép),
   kommentek, valamint a hangok/feliratok.
c) Közösségi / engagement-adatok: kedvelések, mentések, követések, megtekintés-
   számok, remix-kapcsolatok, tartalom-bejelentések (report).
d) Technikai / eszközadatok: eszköz-modell, operációs rendszer, kijelző-felbontás
   (a szolgáltatás működéséhez és kompatibilitáshoz), valamint a működéshez
   szükséges naplók.
e) Előfizetés és vásárlás: a Pro-státusz és az előfizetési időszak, a vásárlás-
   azonosítók, a marketplace-kreditek. BANKKÁRTYA-ADATOT NEM TÁROLUNK — a fizetést
   az áruház (Apple/Google) és a RevenueCat kezeli.
f) Hozzájárulási napló: a regisztrációkor elfogadott feltételek/tájékoztató
   verziója és időpontja (a hozzájárulás igazolhatóságához).
g) Szerepkör / jogosultság: a platform-szerepköröd (pl. néző, moderátor, admin), a
   moderációs műveletek.
h) Saját AI-beállítás (opcionális, BYOK): ha saját AI-szolgáltatót adsz meg, annak
   címe/modellje és API-kulcsa — KIZÁRÓLAG a te AI-hívásaid továbbítására. Az
   API-kulcsot az adat-exportból biztonsági okból kihagyjuk.

3. AZ ADATKEZELÉS CÉLJAI ÉS JOGALAPJAI
- A szolgáltatás nyújtása (fiók, szerkesztő, feed, remix, kommentek): a szerződés
  teljesítése — GDPR 6. cikk (1) b).
- A regisztrációkor adott hozzájárulás alapján kezelt adatok: GDPR 6. cikk (1) a).
- Biztonság, visszaélés- és csalásmegelőzés, moderáció, tartalom-bejelentések
  kezelése: jogos érdek — GDPR 6. cikk (1) f).
- Számlázási/jogszabályi kötelezettségek (ahol alkalmazandó): GDPR 6. cikk (1) c).

4. ADATFELDOLGOZÓK ÉS CÍMZETTEK
Csak a szolgáltatás működéséhez szükséges feldolgozókkal osztunk meg adatot:
- Supabase — adatbázis, hitelesítés, valós idejű szinkron és fájltárolás.
- S3-kompatibilis objektumtár — a renderelt média (videó/borító) tárolása.
- Apple App Store / Google Play és RevenueCat — az előfizetés/vásárlás kezelése
  (bankkártya-adat nálunk nem keletkezik).
- Expo push-szolgáltatás — az értesítések kézbesítése.
- A render/AI-worker (általunk üzemeltetett) — a médiafeldolgozás (render, felirat,
  proxy) idejére.
- Az ÁLTALAD megadott AI-szolgáltató (BYOK, opcionális) — csak a te AI-kéréseidre.
Harmadik félnek MARKETING célból adatot NEM adunk át, és nem adunk el adatot.

5. NEMZETKÖZI ADATTOVÁBBÍTÁS
Az adatokat a fenti szolgáltatók infrastruktúráján tároljuk/dolgozzuk fel. Ha egy
feldolgozó az EGT-n kívül tárol adatot, a továbbítás megfelelő garanciákkal
(pl. EU általános szerződési feltételek, SCC) történik. A tényleges tárolási
régió: «TÁROLÁSI RÉGIÓ (pl. EU) — töltsd ki a tényleges hoszting szerint».

6. TÁROLÁS ÉS MEGŐRZÉS
Az adataidat a fiókod fennállásáig kezeljük. A fiók „törlése" ELSŐ lépésben
DEAKTIVÁLÁS (soft delete): a tartalmad azonnal eltűnik a platformról (mások nem
látják), de az adat megőrződik, és a fiók VISSZAÁLLÍTHATÓ. Végleges (visszavonhatatlan)
törlést a fenti kapcsolaton kérhetsz; a jogszabály által megkövetelt adatokat a
kötelező megőrzési ideig tároljuk.

7. A TE JOGAID (GDPR III. fejezet)
- Hozzáférés és hordozhatóság: az appban egy koppintással LETÖLTHETED a rólad
  tárolt adatok gépi olvasható (JSON) másolatát (Profil → „Adataim letöltése").
- Helyesbítés: a profil-adataid az appban bármikor módosíthatók.
- Törlés („elfeledtetés"): a fiókod az appból deaktiválható (soft delete),
  végleges törlést a kapcsolaton kérhetsz.
- Korlátozás és tiltakozás: kérheted az adatkezelés korlátozását, illetve
  tiltakozhatsz a jogos érdeken alapuló kezelés ellen.
- Hozzájárulás visszavonása: a hozzájárulásod a jövőre nézve bármikor visszavonhatod
  (a szolgáltatás használatához szükséges alapkezelést ez nem érinti).
- Panasz: a felügyeleti hatóságnál. Magyarországon: Nemzeti Adatvédelmi és
  Információszabadság Hatóság (NAIH), https://naih.hu. Más országban a helyi
  adatvédelmi hatóságnál.

8. ADATBIZTONSÁG
Az adatokat sor-szintű hozzáférés-védelemmel (RLS) különítjük el felhasználónként,
a hitelesítés Supabase-JWT-vel történik, a szerver felé titkosított (HTTPS)
kapcsolaton, tokennel. A saját AI-kulcsod az eszközön biztonságos tárban él.

9. GYERMEKEK
A szolgáltatás nem gyermekeknek szól; «MINIMUM ÉLETKOR (pl. 16)» év alatti
felhasználó adatait tudatosan nem kezeljük.

10. A TÁJÉKOZTATÓ VÁLTOZÁSAI
A tájékoztatót időnként frissíthetjük; érdemi változáskor a verziószámot emeljük,
és — ahol szükséges — újra kérjük a hozzájárulást.

11. KAPCSOLAT
Adatvédelmi kérdésekben: «ADATVÉDELMI E-MAIL».`;

export const TERMS = `FELHASZNÁLÁSI FELTÉTELEK
ReMix — interaktív videószerkesztő és közösségi platform
Verzió: ${CONSENT_VERSION} · Utolsó frissítés: ${LEGAL_UPDATED}

A regisztrációval és a szolgáltatás használatával elfogadod ezeket a feltételeket
és az Adatkezelési tájékoztatót.

1. A SZOLGÁLTATÁS
A ReMix egy mobil videószerkesztő, amelyben videót vághatsz, interaktív elemeket
(hotspot, kvíz, elágazás) adhatsz hozzá, és a kész művet közzéteheted egy közösségi
feedben, ahol mások megtekinthetik és — ha engedélyezed — remixelhetik.

2. FIÓK ÉS REGISZTRÁCIÓ
A közösségi funkciókhoz fiók szükséges. A megadott adatok legyenek valósak, a
belépési adataidat tartsd titokban. A fiókodért és a rajta végzett tevékenységért
te felelsz.

3. A TE TARTALMAD ÉS A LICENC
A feltöltött és létrehozott tartalom a TE tulajdonod marad. A feed-be való
közzététellel nem kizárólagos, díjmentes engedélyt adsz arra, hogy a platform a
tartalmadat a szolgáltatás nyújtása érdekében tárolja, megjelenítse és a többi
felhasználó számára elérhetővé tegye; ha a remixelést engedélyezed, arra is, hogy
mások a tartalmad egy PILLANATKÉPÉBŐL remixet készítsenek (önálló műként, a forrás
megjelölésével). Ezt az engedélyt a tartalom eltávolításával/deaktiválásával a
jövőre nézve visszavonod (a már mások által készített remixekre ez nem hat vissza).

4. ELFOGADHATÓ HASZNÁLAT
Tilos jogsértő, gyűlölködő, zaklató, erőszakos, szexuálisan kizsákmányoló, csaló
vagy mások jogait (szerzői jog, személyiségi jog) sértő tartalom közzététele, továbbá
a szolgáltatás rendeltetésellenes vagy a rendszer biztonságát veszélyeztető
használata.

5. MODERÁCIÓ ÉS BEJELENTÉS
A tartalom-tulajdonos a saját tartalmához tartozó kommenteket és remixeket kezelheti
(törölheti/eltávolíthatja). Bármely felhasználó bejelentheti a szabályt sértő
tartalmat; a platform moderátorai a bejelentéseket áttekintik, és a jogsértő
tartalmat eltávolíthatják. A szabályok ismételt vagy súlyos megsértése a fiók
korlátozását vonhatja maga után.

6. SZELLEMI TULAJDON
A ReMix alkalmazás, annak neve, logója és szoftvere az adatkezelő, illetve
licencadói tulajdona. A szolgáltatás használata nem ruház rád semmilyen jogot ezeken
felül.

7. ELŐFIZETÉS (PRO) ÉS FIZETÉS
Egyes funkciók előfizetést (Pro) igényelnek. A fizetés az áruságon (Apple/Google)
keresztül, a RevenueCat közreműködésével történik; a lemondásra és visszatérítésre
az áruház szabályai irányadók. Az eszközön futó alap-szerkesztés és -export
ingyenes.

8. GARANCIA-KIZÁRÁS ÉS FELELŐSSÉG-KORLÁTOZÁS
A szolgáltatás „AHOGY VAN" alapon érhető el, a jogszabály engedte legteljesebb
mértékig kizárva a hallgatólagos szavatosságot. Az adatkezelő nem felel a közvetett
vagy következményi károkért; a felelősség — ahol az korlátozható — a vonatkozó
időszakban ténylegesen kifizetett előfizetési díj összegére korlátozódik.
(A joghatóság-specifikus korlátozásokat jogi átnézés véglegesítse.)

9. A FIÓK MEGSZŰNÉSE
A fiókodat bármikor deaktiválhatod az appból (soft delete; visszaállítható), és
végleges törlést kérhetsz. Súlyos vagy ismételt szabályszegés esetén a fiók
felfüggeszthető vagy megszüntethető.

10. VÁLTOZÁSOK ÉS IRÁNYADÓ JOG
A feltételeket időnként módosíthatjuk; érdemi változáskor a verziószámot emeljük.
Irányadó jog: «IRÁNYADÓ JOG / ORSZÁG (pl. Magyarország)».

11. KAPCSOLAT
Kérdésekben: «KAPCSOLAT / ADATVÉDELMI E-MAIL».`;

export function legalText(doc: LegalDoc): string {
  return doc === 'terms' ? TERMS : PRIVACY_POLICY;
}
