/**
 * 🎓 Interaktív tutorial MAGja (expo-mentes → tesztelhető).
 *
 * A STUDIO.md „Interaktív tutorial — leckék" specjét futtatja: minden LECKE
 * lépések sora, minden LÉPÉS három szöveggel — **Művelet** (mit tegyél) · **Hol**
 * (melyik UI-elem) · **Eredmény** (mit látsz) — és opcionálisan egy `target`-tel,
 * amit a felület-vezető (TutorialOverlay) kiemel (spotlight).
 *
 * A tartalom INLINE, háromnyelvű (`Loc = {hu,en,de}`) — a sok lecke miatt itt
 * tartjuk, nem az i18n-JSON-okban (nem duplázunk kulcs-özönt). A chrome (Tovább/
 * Vissza…) marad i18n-kulcs. Ez a modul csak ADAT + navigáció — nincs React/mérés.
 */

/** Háromnyelvű szöveg. Ismeretlen nyelvnél a magyar a fallback. */
export interface Loc {
  hu: string;
  en: string;
  de: string;
}
const L = (hu: string, en: string, de: string): Loc => ({ hu, en, de });
export function localize(loc: Loc, lang: string | undefined): string {
  const key = (lang ?? 'hu').slice(0, 2) as keyof Loc;
  return loc[key] ?? loc.hu;
}

/** A kiemelhető UI-elemek stabil azonosítói (a `TutorialTarget id`-je). A
 * `toolbar.*` gombok a kijelölés NÉLKÜLI eszköztárban vannak (a passzív tour
 * nem jelöl ki klipet), ezért ezek a leckék belépő lépéseihez megbízhatóan
 * kiemelhetők; a görgethető sorban a Toolbar a targethez görget. */
export type TutorialTargetId =
  | 'toolbar.addVideo'
  | 'toolbar.ai'
  | 'toolbar.text'
  | 'toolbar.music'
  | 'toolbar.grade'
  | 'toolbar.multicam'
  | 'toolbar.captions'
  | 'toolbar.export'
  | 'transport.playPause'
  | 'timeline';

export interface TutorialStep {
  action: Loc;
  where: Loc;
  result: Loc;
  /** melyik UI-elemet emelje ki (ha nincs, középre igazított kártya + a „Hol" szöveg vezet) */
  target?: TutorialTargetId;
}

export type TutorialLevel = 'beginner' | 'advanced' | 'pro';

export interface TutorialLesson {
  id: string;
  level: TutorialLevel;
  /** Pro-lecke (a listában/fejlécben jelezve) */
  pro?: boolean;
  title: Loc;
  steps: TutorialStep[];
}

/** Mért képernyő-téglalap (a spotlighthoz), a `measureInWindow` kimenete. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// rövid step-építő
const S = (action: Loc, where: Loc, result: Loc, target?: TutorialTargetId): TutorialStep => ({
  action,
  where,
  result,
  target,
});

/**
 * A teljes lecke-készlet — a szerkesztő FUNKCIONALITÁSÁT lefedi (STUDIO.md alapján).
 * Kezdő → Haladó → Pro. A `target`-tel jelölt lépések spotlightot kapnak; a többi
 * középre igazított coach-kártya, ahol a „Hol" szöveg vezet.
 */
export const TUTORIAL_LESSONS: TutorialLesson[] = [
  // ─────────────────────────────── 🟢 KEZDŐ ───────────────────────────────
  {
    id: 'basics',
    level: 'beginner',
    title: L('Első lépések', 'First steps', 'Erste Schritte'),
    steps: [
      S(
        L('Adj hozzá egy videót a projekthez.', 'Add a video to your project.', 'Füge ein Video hinzu.'),
        L('Eszköztár → Videó', 'Toolbar → Video', 'Werkzeugleiste → Video'),
        L('A klip megjelenik a videó-sávon, filmstrip-előnézettel.', 'The clip appears on the video track with a filmstrip.', 'Der Clip erscheint auf der Videospur mit Filmstreifen.'),
        'toolbar.addVideo'
      ),
      S(
        L('Indítsd el a lejátszást, majd állítsd meg.', 'Start playback, then pause.', 'Starte die Wiedergabe, dann pausiere.'),
        L('Lejátszás/szünet gomb (K)', 'Play/pause button (K)', 'Wiedergabe/Pause-Taste (K)'),
        L('Az előnézet a lejátszófejtől játszik; a fej középen áll.', 'Preview plays from the playhead; the head stays centered.', 'Vorschau spielt ab dem Abspielkopf; der Kopf bleibt mittig.'),
        'transport.playPause'
      ),
      S(
        L('Léptesd a lejátszófejet és nagyíts.', 'Move the playhead and zoom.', 'Bewege den Abspielkopf und zoome.'),
        L('Idővonal — húzd/görgesd; kétujjas csippentés a zoomhoz', 'Timeline — drag/scroll; pinch to zoom', 'Timeline — ziehen/scrollen; mit zwei Fingern zoomen'),
        L('A tartalom a fej alatt mozog; a lépték 0,2×–4× között vált.', 'Content moves under the head; scale 0.2×–4×.', 'Der Inhalt bewegt sich; Maßstab 0,2×–4×.'),
        'timeline'
      ),
      S(
        L('Koppints egy klipre a kijelöléshez.', 'Tap a clip to select it.', 'Tippe auf einen Clip zum Auswählen.'),
        L('Idővonal — koppints a klipre', 'Timeline — tap the clip', 'Timeline — tippe auf den Clip'),
        L('Keret + trim-fogantyúk; az eszköztár a klip eszközeire vált.', 'Frame + trim handles; the toolbar switches to the clip tools.', 'Rahmen + Trim-Griffe; die Werkzeugleiste wechselt.'),
        'timeline'
      ),
    ],
  },
  {
    id: 'trim',
    level: 'beginner',
    title: L('Vágás és trimmelés', 'Cutting & trimming', 'Schneiden & Trimmen'),
    steps: [
      S(
        L('Vágd el a klipet a lejátszófejnél.', 'Split the clip at the playhead.', 'Teile den Clip am Abspielkopf.'),
        L('Klip kijelölve → Toolbar → Vágás', 'Clip selected → Toolbar → Split', 'Clip gewählt → Werkzeugleiste → Teilen'),
        L('Két klip lesz a vágásponton.', 'Two clips at the cut point.', 'Zwei Clips an der Schnittstelle.')
      ),
      S(
        L('Vágj tetszőleges ponton borotvával.', 'Cut anywhere with the razor.', 'Schneide überall mit dem Rasiermesser.'),
        L('Insight-sáv → ✂️ Borotva be, majd koppints az idővonalon', 'Insight bar → ✂️ Razor on, then tap the timeline', 'Insight-Leiste → ✂️ Rasierer an, dann auf Timeline tippen'),
        L('A koppintás pontján elvágja a lefedő klipet.', 'Splits the clip under the tap.', 'Teilt den Clip unter dem Tippen.')
      ),
      S(
        L('Húzd a klip szélső fogantyúját.', 'Drag the clip edge handle.', 'Ziehe den Rand-Griff des Clips.'),
        L('Kijelölt klip bal/jobb éle', 'Selected clip left/right edge', 'Linker/rechter Rand des Clips'),
        L('Trim + lebegő képkocka-előnézet a szélen.', 'Trim + floating frame preview at the edge.', 'Trim + schwebende Frame-Vorschau am Rand.')
      ),
      S(
        L('Válts trim-módot a profi vágáshoz.', 'Switch trim mode for pro editing.', 'Wechsle den Trim-Modus.'),
        L('Insight-sáv → trim-mód (Ripple/Roll/Slip/Slide)', 'Insight bar → trim mode (Ripple/Roll/Slip/Slide)', 'Insight-Leiste → Trim-Modus'),
        L('A húzás a mód szerint viselkedik (közös vágáspont / forrás-ablak / csúszás).', 'Dragging behaves per mode (roll/slip/slide).', 'Ziehen verhält sich je nach Modus.')
      ),
    ],
  },
  {
    id: 'text',
    level: 'beginner',
    title: L('Szöveg és stílus', 'Text & style', 'Text & Stil'),
    steps: [
      S(
        L('Adj szöveget a videóhoz.', 'Add text to the video.', 'Füge Text hinzu.'),
        L('Eszköztár → Szöveg', 'Toolbar → Text', 'Werkzeugleiste → Text'),
        L('Szöveg-klip + a Szöveg panel nyílik.', 'A text clip + the Text panel opens.', 'Text-Clip + das Text-Panel öffnet sich.'),
        'toolbar.text'
      ),
      S(
        L('Állítsd a stílust: betűtípus, szín, animáció.', 'Set style: font, color, animation.', 'Stil: Schrift, Farbe, Animation.'),
        L('Szöveg panel → Stílus / Anim tabok', 'Text panel → Style / Anim tabs', 'Text-Panel → Stil / Anim'),
        L('Élő előnézet a vásznon.', 'Live preview on the canvas.', 'Live-Vorschau auf der Leinwand.')
      ),
      S(
        L('Pozicionáld a szöveget.', 'Position the text.', 'Positioniere den Text.'),
        L('Vászon — húzd a szöveget (smart-guide-ok)', 'Canvas — drag the text (smart guides)', 'Leinwand — ziehe den Text (Hilfslinien)'),
        L('A szöveg a helyére kerül.', 'The text snaps into place.', 'Der Text rastet ein.')
      ),
    ],
  },
  {
    id: 'tracks',
    level: 'beginner',
    title: L('Sávok kezelése', 'Managing tracks', 'Spuren verwalten'),
    steps: [
      S(
        L('Nyisd a sáv-menüt.', 'Open the track menu.', 'Öffne das Spur-Menü.'),
        L('Koppints a sáv címkéjére / fejlécére', 'Tap the track label / header', 'Tippe auf das Spur-Label'),
        L('Némítás · solo · 👁️ láthatóság · zárolás · összecsukás · magasság.', 'Mute · solo · visibility · lock · collapse · height.', 'Stumm · Solo · Sichtbarkeit · Sperre · Höhe.'),
        'timeline'
      ),
      S(
        L('Rejts el egy vizuális sávot az előnézetből.', 'Hide a visual track from the preview.', 'Blende eine Spur aus.'),
        L('Sáv-menü → 👁️ szem', 'Track menu → 👁️ eye', 'Spur-Menü → 👁️ Auge'),
        L('A sáv klipjei nem látszanak (a rendert nem érinti).', "The track's clips are hidden (render unaffected).", 'Die Clips sind verborgen (Render bleibt).')
      ),
    ],
  },

  // ─────────────────────────────── 🟡 HALADÓ ──────────────────────────────
  {
    id: 'keyframes',
    level: 'advanced',
    title: L('Kulcskocka-animáció (Graph Editor)', 'Keyframe animation (Graph Editor)', 'Keyframe-Animation'),
    steps: [
      S(
        L('Nyisd a Pontos panelt egy videó/kép klipen.', 'Open the Precision panel on a video/image clip.', 'Öffne das Präzise-Panel.'),
        L('Kijelölt klip → Toolbar → Pontos', 'Selected clip → Toolbar → Precision', 'Clip → Werkzeugleiste → Präzise'),
        L('Megnyílik a Graph Editor a csatorna-chipekkel.', 'The Graph Editor opens with channel chips.', 'Der Graph-Editor öffnet sich.')
      ),
      S(
        L('Válassz csatornát és rakj kulcskockát.', 'Pick a channel and add a keyframe.', 'Wähle einen Kanal, setze einen Keyframe.'),
        L('Csatorna-chipek (Méret/Pozíció/Forgatás/Átlátszóság) → „+" a fejnél', 'Channel chips → "+" at the head', 'Kanal-Chips → „+" am Kopf'),
        L('Pont a value/time görbén.', 'A point on the value/time curve.', 'Ein Punkt auf der Kurve.')
      ),
      S(
        L('Formáld a görbét (easing/Bézier).', 'Shape the curve (easing/Bézier).', 'Forme die Kurve (Easing/Bézier).'),
        L('Húzd a pontot; válts easinget, Béziernél a fogókat', 'Drag the point; switch easing, drag Bézier handles', 'Ziehe den Punkt; Easing/Bézier-Griffe'),
        L('Az animáció görbéje (overshoot is lehet).', 'The animation curve (overshoot too).', 'Die Animationskurve (auch Overshoot).')
      ),
    ],
  },
  {
    id: 'masking',
    level: 'advanced',
    title: L('Maszkolás és rotoszkóp', 'Masking & rotoscope', 'Masken & Rotoskopie'),
    steps: [
      S(
        L('Válassz maszkot egy klipre.', 'Choose a mask on a clip.', 'Wähle eine Maske.'),
        L('Kijelölt videó/kép → Szűrő panel → Maszk (ellipszis/téglalap/poligon)', 'Filter panel → Mask (ellipse/rect/polygon)', 'Filter-Panel → Maske'),
        L('Maszk + vászon-fogantyúk.', 'Mask + canvas handles.', 'Maske + Leinwand-Griffe.')
      ),
      S(
        L('Rajzolj szabadkézi maszkot.', 'Draw a freehand mask.', 'Zeichne eine Freihand-Maske.'),
        L('Szűrő → ✏️ Rajzolt maszk, majd húzd körbe a vásznon', 'Filter → ✏️ Draw mask, then trace on canvas', 'Filter → ✏️ Maske zeichnen'),
        L('Poligon-maszk a rajzból (simítás/kiterjesztés/invert).', 'Polygon mask from the drawing.', 'Polygon-Maske aus der Zeichnung.')
      ),
      S(
        L('Animáld a maszkot (rotoszkóp).', 'Animate the mask (rotoscope).', 'Animiere die Maske (Rotoskopie).'),
        L('Szűrő → 🎬 Rotoszkóp; mozgasd a fejet, igazíts, ismételd', 'Filter → 🎬 Rotoscope; move head, adjust, repeat', 'Filter → 🎬 Rotoskopie'),
        L('A maszk a köztes kockákon interpolál.', 'The mask interpolates between frames.', 'Die Maske interpoliert zwischen Frames.')
      ),
    ],
  },
  {
    id: 'audio',
    level: 'advanced',
    title: L('Hang, beat és pro-audio', 'Audio, beat & pro audio', 'Audio, Beat & Pro-Audio'),
    steps: [
      S(
        L('Tölts be zenét.', 'Load music.', 'Lade Musik.'),
        L('Eszköztár → Zene', 'Toolbar → Music', 'Werkzeugleiste → Musik'),
        L('Hangklip a zenesávon, hullámformával.', 'Audio clip on the music track.', 'Audioclip auf der Musikspur.'),
        'toolbar.music'
      ),
      S(
        L('Készíts jelölőket/vágásokat a beatre.', 'Make markers/cuts on the beat.', 'Marker/Schnitte auf den Beat.'),
        L('Zene panel → 🥁 Beat → Jelölők / Vágáspontok', 'Music panel → 🥁 Beat → Markers / Cut points', 'Musik-Panel → 🥁 Beat'),
        L('Markerek vagy kész vágások a ritmusra.', 'Markers or cuts on the rhythm.', 'Marker oder Schnitte im Rhythmus.')
      ),
      S(
        L('Adj hang-effektet.', 'Add an audio effect.', 'Füge einen Audio-Effekt hinzu.'),
        L('Kijelölt hangklip → 🎛️ Pro audio (EQ/kompresszor/pan/reverb)', 'Audio clip → 🎛️ Pro audio (EQ/comp/pan/reverb)', 'Audioclip → 🎛️ Pro-Audio'),
        L('Profi hangkép + hangerő-automáció Graph Editorral.', 'Pro sound + volume automation.', 'Pro-Sound + Lautstärke-Automation.')
      ),
    ],
  },
  {
    id: 'color',
    level: 'advanced',
    title: L('Színfényelés (Grade/Curves/LUT)', 'Color grading (Grade/Curves/LUT)', 'Farbkorrektur'),
    steps: [
      S(
        L('Alapfényelés: tónus és szín.', 'Basic grade: tone & color.', 'Basis-Grade: Ton & Farbe.'),
        L('Grade réteg / klip → Szűrő → 🎚️ Tónus, 🎨 Szín', 'Grade layer / Filter → 🎚️ Tone, 🎨 Color', 'Grade / Filter → 🎚️ Ton, 🎨 Farbe'),
        L('Expozíció/árnyékok + hőmérséklet/szaturáció a helyére kerül.', 'Exposure/shadows + temp/saturation set.', 'Belichtung + Temperatur/Sättigung.'),
        'toolbar.grade'
      ),
      S(
        L('Görbézz csatornánként.', 'Curve per channel.', 'Kurven pro Kanal.'),
        L('📈 Görbék → RGB/R/G/B, koppints/húzz', '📈 Curves → RGB/R/G/B, tap/drag', '📈 Kurven → RGB/R/G/B'),
        L('Pontos tónus- és színcsatorna-kontroll.', 'Precise tone & channel control.', 'Präzise Ton-/Kanalkontrolle.')
      ),
      S(
        L('Ellenőrizz szkóppal, húzz rá LUT-ot.', 'Check with scopes, apply a LUT.', 'Prüfe mit Skopen, wende ein LUT an.'),
        L('🩻 Szkópok (waveform/vektorszkóp) · 🎞️ 3D LUT (.cube import/export)', '🩻 Scopes · 🎞️ 3D LUT (.cube)', '🩻 Skope · 🎞️ 3D-LUT'),
        L('Objektív mérés + egységes, megosztható look.', 'Objective read + shareable look.', 'Objektive Messung + Look.')
      ),
    ],
  },
  {
    id: 'transitions',
    level: 'advanced',
    title: L('Átmenetek', 'Transitions', 'Übergänge'),
    steps: [
      S(
        L('Tegyél átmenetet a következő klipre.', 'Add a transition to the next clip.', 'Übergang zum nächsten Clip.'),
        L('Klip → Áttűnés panel → típus a „Következő klipre" alatt', 'Clip → Transition panel → type', 'Clip → Übergang-Panel → Typ'),
        L('Átmenet a következő klipre.', 'A transition to the next clip.', 'Ein Übergang zum nächsten Clip.')
      ),
      S(
        L('Finomhangold az átmenetet.', 'Fine-tune the transition.', 'Feinabstimmung.'),
        L('🎬 Átmenet szerkesztése → hossz · irány · easing · elmosás · zoom/forgás', '🎬 Edit transition → duration · direction · easing · blur · zoom/rotate', '🎬 Übergang bearbeiten'),
        L('A flourishök az átmenet ablakában hatnak (renderben égnek be).', 'Flourishes act in the window (baked in render).', 'Effekte wirken im Fenster.')
      ),
    ],
  },
  {
    id: 'compositing',
    level: 'advanced',
    title: L('Compositing (blend/green screen/matte)', 'Compositing (blend/green screen/matte)', 'Compositing'),
    steps: [
      S(
        L('Keverd a réteget az alatta lévővel.', 'Blend the layer with the one below.', 'Mische die Ebene.'),
        L('Forma / PiP panel → blend-mód (multiply/screen/…)', 'Shape / PiP panel → blend mode', 'Form / PiP → Blend-Modus'),
        L('A réteg a blend szerint keveredik.', 'The layer blends per mode.', 'Die Ebene mischt sich.')
      ),
      S(
        L('Kulcsolj ki green screent.', 'Key out a green screen.', 'Green Screen ausstanzen.'),
        L('Szűrő → green screen: 🎨 Színpipetta → Tolerance → Feather → Spill', 'Filter → green screen: eyedropper → tolerance → feather → spill', 'Filter → Green Screen'),
        L('A háttér eltűnik, a perem letisztul.', 'Background gone, edges clean.', 'Hintergrund weg, Kanten sauber.')
      ),
      S(
        L('Fogj össze klipeket egy blokká.', 'Group clips into one block.', 'Fasse Clips zusammen.'),
        L('Több klip kijelölve → Toolbar → Pre-compose', 'Multiple clips → Toolbar → Pre-compose', 'Mehrere Clips → Pre-compose'),
        L('Egy compound klip, együtt mozgatható/effektelhető.', 'One compound clip, movable/effectable together.', 'Ein Compound-Clip.')
      ),
    ],
  },
  {
    id: 'shapes',
    level: 'advanced',
    title: L('Vektorformák (toll/gradient/path)', 'Vector shapes (pen/gradient/path)', 'Vektorformen'),
    steps: [
      S(
        L('Rajzolj path-t a tollal.', 'Draw a path with the pen.', 'Zeichne einen Pfad.'),
        L('Forma panel → ✏️ Toll: koppints horgonyokhoz, húzd a fogókat', 'Shape panel → ✏️ Pen: tap anchors, drag handles', 'Form-Panel → ✏️ Stift'),
        L('Pontos Bézier-forma (zárva = kitöltött).', 'Precise Bézier shape (closed = filled).', 'Präzise Bézier-Form.')
      ),
      S(
        L('Színezd gradienssel, kombinálj booleannel.', 'Color with gradient, combine with boolean.', 'Gradient + Boolean.'),
        L('🌈 Fejlett gradient · két forma → 🔗 Boolean', '🌈 Gradient · two shapes → 🔗 Boolean', '🌈 Gradient · 🔗 Boolean'),
        L('Multi-stop kitöltés / összetett forma.', 'Multi-stop fill / compound shape.', 'Multi-Stop / Compound-Form.')
      ),
      S(
        L('Animáld a path-t.', 'Animate the path.', 'Animiere den Pfad.'),
        L('🎞️ Path-animáció → Megrajzol / Morph', '🎞️ Path animation → Draw / Morph', '🎞️ Pfad-Animation'),
        L('A vonal megrajzolja magát / morfol (renderben).', 'The line draws itself / morphs.', 'Die Linie zeichnet/morpht sich.')
      ),
    ],
  },
  {
    id: 'speed',
    level: 'advanced',
    title: L('Time remapping (sebesség-görbe)', 'Time remapping (speed curve)', 'Time-Remapping'),
    steps: [
      S(
        L('Rajzolj sebesség-görbét.', 'Draw a speed curve.', 'Zeichne eine Geschwindigkeitskurve.'),
        L('Videóklip → Sebesség → Egyéni görbe → húzd az oszlopokat → Alkalmaz', 'Video → Speed → Custom curve → drag bars → Apply', 'Video → Tempo → Kurve'),
        L('A klip a görbe szerint gyorsul/lassul.', 'The clip speeds up/slows per curve.', 'Der Clip folgt der Kurve.')
      ),
      S(
        L('Simítsd a lassítást és fagyassz kockát.', 'Smooth slow-mo and freeze a frame.', 'Slow-Mo glätten, Frame einfrieren.'),
        L('⏱️ Optical flow · ❄️ Freeze a lejátszófejnél', '⏱️ Optical flow · ❄️ Freeze at head', '⏱️ Optical Flow · ❄️ Freeze'),
        L('Sima slow-motion; a kép megáll, a hang tovább szól.', 'Smooth slow-mo; frame holds, audio continues.', 'Sanftes Slow-Mo; Standbild.')
      ),
    ],
  },

  // ─────────────────────────────── 🔵 PRO ─────────────────────────────────
  {
    id: 'captions',
    level: 'pro',
    pro: true,
    title: L('Automatikus felirat', 'Auto captions', 'Auto-Untertitel'),
    steps: [
      S(
        L('Kérj feliratot a beszédből.', 'Request captions from speech.', 'Untertitel aus Sprache.'),
        L('Eszköztár → Felirat → „Felirat a beszédből (Whisper)"', 'Toolbar → Captions → "Captions from speech (Whisper)"', 'Werkzeugleiste → Untertitel → Whisper'),
        L('Időzített feliratok (fordítás/karaoke opcióval).', 'Timed captions (translate/karaoke).', 'Getaktete Untertitel.'),
        'toolbar.captions'
      ),
    ],
  },
  {
    id: 'aiEdit',
    level: 'pro',
    pro: true,
    title: L('AI-vágás és kép-AI', 'AI editing & image AI', 'KI-Schnitt & Bild-KI'),
    steps: [
      S(
        L('Automatikus vágás / újrakeretezés / Shorts.', 'Auto-edit / reframe / Shorts.', 'Auto-Schnitt / Reframe / Shorts.'),
        L('Eszköztár → AI → Auto-Edit / Smart Reframe / Shorts', 'Toolbar → AI → Auto-Edit / Smart Reframe / Shorts', 'Werkzeugleiste → AI'),
        L('Az AI vágási tervet készít; te hagyod jóvá.', 'The AI proposes an edit; you approve.', 'Die KI schlägt einen Schnitt vor.'),
        'toolbar.ai'
      ),
      S(
        L('Kép-AI: alany-kiemelés, ég-csere, felskálázás.', 'Image AI: subject cutout, sky swap, upscale.', 'Bild-KI: Freistellen, Himmel, Upscale.'),
        L('Kijelölt kép/videó → Szűrő panel', 'Selected image/video → Filter panel', 'Bild/Video → Filter-Panel'),
        L('A felhő-worker feldolgozza (Pro).', 'The cloud worker processes it (Pro).', 'Der Cloud-Worker verarbeitet (Pro).')
      ),
    ],
  },
  {
    id: 'tracking',
    level: 'pro',
    pro: true,
    title: L('Objektum-követés', 'Object tracking', 'Objekt-Tracking'),
    steps: [
      S(
        L('Válaszd ki, mi kövessen egy objektumot.', 'Pick what should follow an object.', 'Wähle das folgende Element.'),
        L('Klip → Pontos/Forma/Szöveg/Szűrő → 🎯 Kövess egy objektumot', 'Clip → Precision/Shape/Text/Filter → 🎯 Track an object', 'Clip → 🎯 Objekt verfolgen'),
        L('Koppints a videón a követendő objektumra.', 'Tap the object to track on the video.', 'Tippe auf das Objekt.')
      ),
      S(
        L('Indítsd a követést.', 'Start tracking.', 'Starte das Tracking.'),
        L('A worker végigköveti a mozgást', 'The worker tracks the motion', 'Der Worker verfolgt die Bewegung'),
        L('Az elem (szöveg/kép/maszk) kulcskockákkal követi az objektumot.', 'The element follows with keyframes.', 'Das Element folgt mit Keyframes.')
      ),
    ],
  },
  {
    id: 'aiPreview',
    level: 'pro',
    pro: true,
    title: L('AI-változások előnézete', 'Preview AI changes', 'KI-Änderungen prüfen'),
    steps: [
      S(
        L('Kérj módosítást az AI-tól.', 'Ask the AI for an edit.', 'Bitte die KI um eine Änderung.'),
        L('Eszköztár → AI → írd be az utasítást', 'Toolbar → AI → type the instruction', 'Werkzeugleiste → AI'),
        L('Megjelenik a változás-lista — az AI még semmit nem módosít.', "A change list appears — nothing modified yet.", 'Eine Änderungsliste erscheint.'),
        'toolbar.ai'
      ),
      S(
        L('Nézd meg az eredményt élőben.', 'See the result live.', 'Sieh das Ergebnis live.'),
        L('AI-panel → Előnézet', 'AI panel → Preview', 'KI-Panel → Vorschau'),
        L('A szerkesztő ideiglenesen alkalmazza — látod a tényleges eredményt.', 'Applied temporarily — you see the actual result.', 'Vorübergehend angewendet.')
      ),
      S(
        L('Dönts: tartsd meg vagy vond vissza.', 'Decide: keep or revert.', 'Behalten oder rückgängig.'),
        L('Megtartás / Visszavonás', 'Keep / Revert', 'Behalten / Rückgängig'),
        L('Csak jóváhagyás után módosul véglegesen; a Visszavonás visszaáll.', 'Permanent only after you approve; Revert restores.', 'Erst nach Bestätigung dauerhaft.')
      ),
    ],
  },
  {
    id: 'multicam',
    level: 'pro',
    pro: true,
    title: L('Multicam (több kameraszög)', 'Multicam', 'Multicam'),
    steps: [
      S(
        L('Add hozzá a szögeket és szinkronizálj.', 'Add angles and sync.', 'Winkel hinzufügen, synchronisieren.'),
        L('Eszköztár → Multicam → + Szög · 🎚️ Auto-sync (hang)', 'Toolbar → Multicam → + Angle · 🎚️ Auto-sync (audio)', 'Werkzeugleiste → Multicam'),
        L('A szögök a hullámforma alapján egymáshoz igazodnak.', 'Angles align by waveform.', 'Winkel richten sich aus.'),
        'toolbar.multicam'
      ),
      S(
        L('Vágj élőben és építs szekvenciát.', 'Cut live and build a sequence.', 'Live schneiden, Sequenz bauen.'),
        L('🔴 Élő szögváltás → 🎬 Multicam-szekvencia', '🔴 Live switching → 🎬 Multicam sequence', '🔴 Live-Umschaltung'),
        L('A vágások normál klipként tovább finomíthatók.', 'Cuts remain editable as normal clips.', 'Schnitte bleiben bearbeitbar.')
      ),
    ],
  },
  {
    id: 'export',
    level: 'pro',
    title: L('Export és közzététel', 'Export & publish', 'Export & Veröffentlichen'),
    steps: [
      S(
        L('Nyisd az Exportot és válassz presetet.', 'Open Export and pick a preset.', 'Öffne Export, wähle ein Preset.'),
        L('Fejléc → Export → TikTok/Reels/Shorts/YouTube', 'Header → Export → TikTok/Reels/Shorts/YouTube', 'Kopfzeile → Export'),
        L('Felbontás/FPS/bitráta/kodek beáll; Haladó alatt HDR/10-bit.', 'Resolution/FPS/bitrate/codec set.', 'Auflösung/FPS/Bitrate/Codec.'),
        'toolbar.export'
      ),
      S(
        L('Exportálj eszközön vagy felhőben, vagy oszd meg.', 'Export on device or cloud, or publish.', 'Exportiere lokal/Cloud oder teile.'),
        L('Local MP4 (ingyen) · Felhő HD/4K [PRO] · Közzététel a feedbe [PRO]', 'Local MP4 (free) · Cloud HD/4K [PRO] · Publish [PRO]', 'Lokal MP4 · Cloud HD [PRO] · Feed [PRO]'),
        L('Kész MP4 a Fotókban, vagy a publikus videó a feedben.', 'MP4 in Photos, or the public video in the feed.', 'MP4 in Fotos oder im Feed.')
      ),
    ],
  },
];

export function getLesson(id: string): TutorialLesson | undefined {
  return TUTORIAL_LESSONS.find((l) => l.id === id);
}

/** A leckék szint szerint csoportosítva (a lecke-választóhoz). */
export function lessonsByLevel(): { level: TutorialLevel; lessons: TutorialLesson[] }[] {
  const order: TutorialLevel[] = ['beginner', 'advanced', 'pro'];
  return order.map((level) => ({ level, lessons: TUTORIAL_LESSONS.filter((l) => l.level === level) }));
}

/**
 * A következő lépés indexe; ha túlfut, `-1` = a lecke KÉSZ. Tiszta függvény,
 * hogy a léptetés-logika a store/overlay nélkül is tesztelhető legyen.
 */
export function nextStepIndex(current: number, total: number): number {
  return current + 1 >= total ? -1 : current + 1;
}

/** Az előző lépés indexe (0 alá nem megy). */
export function prevStepIndex(current: number): number {
  return current > 0 ? current - 1 : 0;
}
