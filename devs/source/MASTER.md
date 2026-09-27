Átnéztem a jelenlegi `main` állapotot és a hozzá tartozó `STUDIO.md`, `DEV-PLAN.md`, capability-, projekt-, social-, shop- és profilréteget is. A repo **videós oldalról már meglepően mély**: timeline, multicam, keyframe/Graph Editor, color grading, masking, chroma, tracking, captions, Voice Studio, beat sync, AI edit, Smart Search, Creative Canvas, 3D, marketplace, social, collab-alapok stb. már jelen vannak vagy részben implementálva vannak.

Viszont ha a cél nem egy „nagyon jó videóeditor”, hanem **a ReMix legyen a kreatív ember teljes otthona**, akkor van egy nagyon fontos felismerés:

> **Nem még 100 külön feature hiányzik. A közös Creative Operating System hiányzik, amely ugyanazt az asset/project/AI/social/workflow rendszert minden művészeti ág számára használhatóvá teszi.**

[ReMix GitHub repository](https://github.com/M4rkH3nz3L/ReMix?utm_source=chatgpt.com)

## 1. A legnagyobb hiány: a ReMix még mindig „videós appként” gondolkodik

A jelenlegi architektúra központja:

**Project → Timeline → Clips → Render**

Ez videónál kiváló.

De egy zenésznek inkább:

**Song → Tracks → Takes → Arrangement → Mix → Master**

Egy fotósnak:

**Shoot → Photos → Selects → Edit → Album → Export**

Egy designernek:

**Document → Layers → Components → Assets → Versions → Export**

Egy írónak:

**Workspace → Documents → Chapters → Research → Drafts → Publish**

Egy developernek:

**Workspace → Files → Code → Preview → Git → Deploy**

Ezért én a következő nagy architekturális réteget tenném be:

# 🧠 CREATOR OS

Nem külön „fotós mód”, „zenész mód”, „író mód”.

Hanem:

```text
                    ReMix
                      │
              CREATOR OS CORE
                      │
       ┌──────────────┼──────────────┐
       │              │              │
     ASSETS        PROJECTS          AI
       │              │              │
       └──────────────┼──────────────┘
                      │
              CREATIVE WORKSPACE
                      │
 ┌──────┬──────┬──────┼──────┬──────┬──────┐
 Video Photo Design Audio Writing Code 3D
```

És erre ülnek rá a szerepek.

---

# 2. 🎬 VIDEÓS — mi hiányzik még?

A videós rész már a legerősebb.

De profi napi használathoz még:

### Felvétel

* több szegmenses kamera
* pause/resume recording
* front/back multicam recording
* external microphone
* Bluetooth mic
* audio input selection
* exposure lock
* focus lock
* white balance lock
* manual ISO/shutter
* 24/25/30/50/60/120 fps
* log/flat recording támogatás, ahol elérhető
* teleprompter
* remote camera
* clap/sync marker
* recording presets

### Vágás

* J/L/K workflow finomítása
* keyboard shortcuts iPad/desktop
* pancake timeline
* source monitor
* program monitor
* audio meters
* clip markers
* subclips
* multicam angles kezelése
* adjustment clips
* nested sequences
* compound sequence templates

### Profi média-management

Ez szerintem **P0**.

```text
Project
 ├── Footage
 ├── Audio
 ├── Images
 ├── Graphics
 ├── Fonts
 ├── SFX
 ├── Exports
 └── Proxies
```

És:

* bins
* smart bins
* tags
* ratings
* favorites
* color labels
* metadata
* duplicate detection
* missing media detection
* relink
* proxy status
* source resolution
* codec
* FPS
* audio channels
* camera metadata

A repo már elkezdte ezt az `Organize` résszel, de ezt **teljes Media Management Systemmé** kell emelni.

---

# 3. 📸 FOTÓS — itt van az egyik legnagyobb lyuk

A Creative Canvas nagyon jó alap, de **még nem Lightroom/Affinity/Photoshop-szintű fotós workflow**.

Kellene:

### RAW

* RAW import
* DNG
* ProRAW
* RAW metadata
* non-destructive RAW development
* exposure
* highlights
* shadows
* whites
* blacks
* temperature
* tint
* texture
* clarity
* dehaze
* sharpening
* noise reduction
* chromatic aberration
* lens correction
* distortion
* vignette

### Retus

* healing brush
* clone stamp
* blemish removal
* skin retouch
* teeth
* eyes
* dodge & burn
* frequency separation jellegű workflow
* face-aware retouch

### Selection

* subject select
* person select
* sky
* background
* hair
* object
* color range
* luminosity range

### Fotós workflow

```text
Import
 ↓
Culling
 ↓
Rating
 ↓
Selection
 ↓
Develop
 ↓
Retouch
 ↓
Preset
 ↓
Album
 ↓
Export
```

### Batch editing

Ez **nagyon fontos**.

> Egy fotós nem 100 képet egyenként akar szerkeszteni.

Kell:

* copy adjustments
* paste adjustments
* sync edits
* batch AI
* batch resize
* batch watermark
* batch export
* contact sheet
* before/after
* compare view

---

# 4. 🎨 DESIGNER — ezt érdemes nagyon komolyan venni

A Creative Canvas már jó irány.

De designer-platformmá akkor válik, ha bekerül:

## Vector engine

* SVG native editing
* Bézier
* pen
* node editing
* boolean
* compound paths
* stroke
* fills
* gradients
* pattern
* vector masks
* path operations
* outline stroke
* expand appearance

## Layout engine

* auto layout
* constraints
* responsive resizing
* grids
* columns
* guides
* rulers
* spacing tokens
* alignment
* distribution

## Components

```text
Component
 ├── variants
 ├── properties
 ├── states
 └── instances
```

## Design system

* colors
* typography
* spacing
* radius
* shadows
* components
* tokens

## Figma-szerű együttműködés

* multiplayer cursor
* comments
* mentions
* selections
* version history
* branch
* duplicate
* review mode

## Export

* SVG
* PNG
* JPG
* PDF
* WebP
* AVIF
* transparent
* @1x/@2x/@3x

---

# 5. 🎵 ZENÉSZ

**Ez jelenleg a legnagyobb funkcionális szakadék a repo és a cél között.**

A jelenlegi audio-réteg elsősorban:

> video → music → voiceover → SFX → mix

Egy zenésznek viszont:

> **DAW**

kell.

## Minimum Music Studio

### Timeline

* multitrack
* bars/beats
* BPM
* time signature
* tempo map
* markers
* loop regions
* quantization

### MIDI

* MIDI tracks
* piano roll
* note editing
* velocity
* quantize
* swing
* transpose
* scale lock
* chord detection

### Instruments

* sampler
* drum machine
* synth
* piano
* bass
* guitar
* orchestral instruments

### Recording

* multitrack recording
* punch in/out
* overdub
* takes
* comping
* latency compensation
* monitoring

### Audio

* waveform editing
* gain
* fades
* crossfade
* time stretch
* pitch shift
* reverse
* normalize

---

# 6. 🎤 ÉNEKES

A zenész-modulból külön creator workflow:

## Vocal Studio

* vocal recording
* takes
* comping
* pitch visualization
* pitch correction
* timing correction
* harmony generation
* doubles
* adlibs
* vocal layering
* noise removal
* de-reverb
* de-esser
* compressor
* EQ
* saturation
* reverb
* delay

### AI Vocal Assistant

Például:

> „Tisztítsd meg az éneket.”

> „Csinálj belőle rádióhangzást.”

> „Duplázd meg a refrént.”

> „Legyen Billie Eilish-szerűen sötét.”

Utóbbinál természetesen konkrét élő előadó utánzását nem érdemes termékfunkcióvá tenni; a lényeg a **hangkarakter leírásából** történő vezérlés.

---

# 7. 🎧 PRODUCER

Itt már egy teljes **Music Production Workspace** kell.

### Mixer

```text
TRACK
 ├── Volume
 ├── Pan
 ├── EQ
 ├── Compressor
 ├── FX
 ├── Sends
 ├── Automation
 └── Bus
```

### Bus rendszer

* drum bus
* vocal bus
* music bus
* FX bus
* master

### Automation

* volume
* pan
* plugin parameters
* send
* mute
* filter

### Mastering

* LUFS
* true peak
* limiter
* compressor
* EQ
* stereo width
* spectrum analyzer
* loudness meter
* waveform
* clipping detection

### Stem separation

Ez szerintem **óriási ReMix feature** lehetne:

```text
Song
 ↓
AI Stem Split
 ├── Vocals
 ├── Drums
 ├── Bass
 ├── Guitar
 ├── Piano
 ├── Other
 └── FX
```

És minden stem azonnal szerkeszthető.

---

# 8. 🎮 GAMER

A gamernek nem ugyanaz kell, mint egy videósnak.

## Capture Center

* screen recording
* game recording
* microphone
* webcam
* system audio
* party audio
* separate tracks
* replay buffer
* instant replay
* clip marker
* hotkey marker

### Gaming editor

* kill markers
* death markers
* round markers
* match timeline
* automatic highlight
* best moments
* reaction cam
* facecam
* game audio
* voice chat

### AI

> „Mutasd az összes killt.”

> „Készíts 30 másodperces montage-ot.”

> „Keresd meg a legjobb clutchot.”

> „Készíts TikTok verziót.”

---

# 9. ✍️ ÍRÓ

Ez **teljesen hiányzó horizont**.

Kellene:

# ReMix Writer

### Editor

* rich text
* Markdown
* headings
* lists
* tables
* footnotes
* links
* images
* embeds

### Dokumentum

```text
Workspace
 ├── Book
 │    ├── Chapter 1
 │    ├── Chapter 2
 │    └── Chapter 3
 ├── Characters
 ├── Locations
 ├── Research
 └── Notes
```

### Writing tools

* grammar
* spelling
* rewrite
* tone
* summarize
* expand
* shorten
* translate
* outline
* brainstorm
* citation management

### AI context

Az AI tudja:

> ki a szereplő

> mi történt az előző fejezetben

> milyen stílusban írsz

> milyen terminológiát használsz

Ez vezet el az egyik legfontosabb ReMix-funkcióhoz.

---

# 10. 🎙️ PODCASTER

Ez különösen jól illik a jelenlegi videó/audio alapokhoz.

## Podcast Studio

```text
Host
Guest
Music
SFX
Ads
Room tone
```

### Funkciók

* multitrack recording
* remote guests
* separate audio tracks
* automatic sync
* silence removal
* filler-word removal
* transcript
* speaker detection
* chapters
* show notes
* timestamps
* clips
* audiograms
* waveform video
* subtitles
* podcast cover

### Egy felvételből:

```text
2 hour podcast
      ↓
AI
 ├── Full episode
 ├── 10 highlights
 ├── 20 Shorts
 ├── Quote cards
 ├── Audiograms
 ├── Transcript
 ├── Chapters
 ├── Show notes
 └── Social posts
```

**Ez nagyon ReMix-kompatibilis.**

---

# 11. 💻 DEVELOPER

Ez már egy teljesen új kategória.

Ha tényleg minden creatort akarsz:

# ReMix Code

Nem feltétlenül teljes VS Code-klón első körben.

### Minimum:

* code editor
* syntax highlighting
* file tree
* tabs
* search
* terminal
* preview
* Git
* diff
* snippets
* extensions
* environment variables

### AI

```text
Ask AI
 ↓
READ workspace
 ↓
UNDERSTAND
 ↓
PLAN
 ↓
EDIT
 ↓
DIFF
 ↓
APPROVE
 ↓
RUN
 ↓
TEST
```

A jelenlegi **AI Command Bus** architektúra nagyon jól újrahasznosítható erre.

---

# 12. 🤖 AI CREATOR

Ez szerintem **nem egy szerepkör legyen a többi mellett**.

Hanem az egész ReMix fölötti réteg.

Az AI-nak ismernie kell:

```text
User
 ├── Roles
 ├── Skills
 ├── Preferences
 ├── Brand
 ├── Projects
 ├── Assets
 ├── History
 ├── AI providers
 └── Workflows
```

És:

# Creator Memory

Például:

> „Ez az én YouTube stílusom.”

> „Mindig ilyen feliratot használok.”

> „Ezek a kedvenc hangszíneim.”

> „Ezek a saját zenéim.”

> „Ezt a kamerát használom.”

> „Ezt a LUT-ot szeretem.”

---

# 13. 🧠 A legfontosabb hiány: CREATOR PROFILE 2.0

A repo-ban már van profile, AI provider, role/RBAC stb., de ezt nem csak accountként kell kezelni.

Hanem **alkotói identitásként**.

```text
CREATOR
│
├── Identity
│   ├── name
│   ├── username
│   ├── avatar
│   ├── cover
│   └── bio
│
├── Disciplines
│   ├── Video
│   ├── Photo
│   ├── Design
│   ├── Music
│   └── Writing
│
├── Skills
│
├── Equipment
│
├── Software
│
├── Brand
│
├── Portfolio
│
├── Projects
│
├── Assets
│
├── Templates
│
├── Presets
│
└── AI Persona
```

És **több szerep egyszerre**:

> Videós + Producer + Designer

nem pedig egyetlen role.

---

# 14. 🗂️ ASSET LIBRARY — ezt P0-ra tenném

A ReMix egyik legfontosabb funkciója lehet.

Egy központi:

# My Assets

```text
🎥 Videos
📸 Photos
🎵 Music
🎙️ Voice
🔊 SFX
🎨 Graphics
🔤 Fonts
🧊 3D
📝 Documents
💻 Code
🤖 AI
```

Minden asset:

* preview
* metadata
* tags
* collections
* favorites
* versions
* source
* license
* creator
* project usage
* AI embedding
* semantic search

És:

> **„Hol használtam ezt a logót?”**

> **„Mutasd az összes projektet, amely ezt a zenét használja.”**

> **„Keresd meg az összes fotót, ahol a kutya látható.”**

---

# 15. 🔎 UNIVERSAL SEARCH

Ez óriási hiány.

Ne csak Smart Search legyen a videóhoz.

Hanem:

# ⌘K / Global Search

```text
Search everything…

Projects
Assets
People
Messages
Music
Photos
Videos
Documents
Templates
Shop
AI
```

És természetes nyelv:

> „Mutasd a tavalyi nyári fotókat.”

> „Hol van a neon logóm?”

> „Keresd az összes videót, ahol autó van.”

> „Mutasd a félbehagyott projekteket.”

> „Hol használtam a `H3nz3L` intro-t?”

---

# 16. 📁 PROJECT → WORKSPACE

Ez szerintem a jelenlegi modell egyik legfontosabb továbbfejlesztése.

Most:

```text
Project
 └── timeline
```

Legyen:

```text
WORKSPACE
│
├── Projects
├── Assets
├── Documents
├── Media
├── Audio
├── Designs
├── Code
├── Notes
├── Tasks
├── Calendar
├── Team
├── Messages
└── AI
```

Egy creator így **nem hagyja el az appot**.

---

# 17. 🧩 TEMPLATE SYSTEM 2.0

A marketplace jelenlegi iránya jó, de sokkal tovább lehet vinni.

Ne csak:

* template
* LUT
* SFX
* font
* preset

hanem:

### Workflow Template

Például:

**YouTube Creator**

```text
Footage
 ↓
AI Select
 ↓
Transcript
 ↓
Filler Removal
 ↓
Hook
 ↓
Captions
 ↓
B-roll
 ↓
Color
 ↓
Thumbnail
 ↓
Export
 ↓
Publish
```

Vagy:

**Podcast**

```text
Record
 ↓
Sync
 ↓
Clean
 ↓
Transcript
 ↓
Chapters
 ↓
Clips
 ↓
Audiogram
 ↓
Publish
```

Ez sokkal erősebb, mint egyszerű presetek.

---

# 18. 🔄 VERSION CONTROL

A videós verzióhistory már elindult.

Ezt globálissá kell tenni:

```text
v1
v2
v3
Draft
Review
Approved
Published
Archived
```

És minden creator-típusnál:

* diff
* restore
* duplicate
* branch
* compare
* comment
* approve

Designer:

> „Mi változott?”

Zenész:

> „Mi változott a mixben?”

Író:

> „Mi változott a fejezetben?”

Developer:

> Git diff.

---

# 19. 👥 CREATIVE COLLABORATION

A DB-ben már van komoly alap, de a teljes kreatív collaboration még hiányzik.

Kell:

* live presence
* cursor
* selection
* project roles
* reviewer
* editor
* producer
* owner
* comments
* mentions
* timecode comments
* frame comments
* audio comments
* design comments
* approval workflow

Például:

> „@Anna ezt a részt javítsd.”

> „@Márk 01:32-nél túl hangos.”

> „@Dani ezt a logót cseréld.”

---

# 20. 💬 CHAT → CREATIVE COMMAND CENTER

A messaging rendszer már bekerült.

De a chatnek tudnia kellene:

> „Küldd el Annának a tegnapi projektet.”

> „Nyisd meg a projektet.”

> „Készíts belőle egy 30 mp-es verziót.”

> „Exportáld.”

> „Oszd meg a producerrel.”

Tehát:

**chat ≠ csak chat**

hanem:

# Chat + Workspace Control

---

# 21. 📅 CREATOR PLANNER

Ez teljesen hiányzik.

Egy creatornek kell:

```text
Ideas
 ↓
Backlog
 ↓
Production
 ↓
Editing
 ↓
Review
 ↓
Scheduled
 ↓
Published
```

### Tartalomnaptár

* YouTube
* TikTok
* Instagram
* Spotify
* Podcast
* blog
* newsletter

### AI

> „Ezen a héten mit kell elkészítenem?”

> „Melyik projekt áll félbe?”

> „Készíts publikációs tervet.”

---

# 22. 📊 CREATOR ANALYTICS

A DEV-PLAN ezt már említi, de **nem szabad csak social analyticsként kezelni**.

Legyen:

# Creator Analytics

```text
Content
Projects
Audience
Revenue
Workflow
Productivity
```

Például:

* mennyi időt szerkesztett
* mennyi tartalmat készített
* melyik workflow lassú
* melyik template működik
* melyik tartalom teljesít jól
* melyik hook működik
* melyik thumbnail működik

És AI:

> „Miért működött ez a videó jobban?”

---

# 23. 💰 CREATOR BUSINESS

Ha tényleg „otthon” akarod tartani:

* invoices
* clients
* projects
* quotes
* contracts
* deliverables
* payments
* licenses
* sponsorships
* affiliate links
* digital products
* marketplace income

### Creator CRM

```text
Client
 ├── Projects
 ├── Files
 ├── Messages
 ├── Invoices
 └── Deliverables
```

---

# 24. 🛒 MARKETPLACE 2.0

A jelenlegi Shop jó kezdet.

De a teljes ökoszisztéma:

### Vásárolható

* video templates
* LUT
* presets
* fonts
* music
* SFX
* sample packs
* MIDI
* instruments
* 3D assets
* graphics
* photo presets
* design systems
* workflows
* AI agents
* AI personas

### Eladható

Ugyanez.

Így a creator nemcsak fogyasztó:

> **creator → creator economy**

---

# 25. 🧠 AI AGENT MARKETPLACE

Ez különösen jól illik a ReMixhez.

Például:

### 🎬 Video Editor Agent

### 🎨 Art Director Agent

### 🎵 Music Producer Agent

### 📸 Photo Editor Agent

### ✍️ Writing Agent

### 🎙️ Podcast Producer Agent

### 💻 Coding Agent

### 📱 Social Media Agent

És mindegyik ugyanazt az API-t használja:

```text
READ
 ↓
UNDERSTAND
 ↓
PLAN
 ↓
PROPOSE
 ↓
APPROVE
 ↓
COMMAND BUS
 ↓
EXECUTE
 ↓
VERIFY
```

A jelenlegi AI Edit Engine erre **nagyon jó alap**.

---

# 26. 🧬 CREATIVE GRAPH

Ez szerintem a ReMix egyik legnagyobb hosszú távú differentiátora lehet.

Minden összekapcsolódik:

```text
Person
   │
   ├── Project
   │      ├── Video
   │      ├── Audio
   │      ├── Image
   │      └── Design
   │
   ├── Asset
   │
   ├── Brand
   │
   ├── Template
   │
   ├── Music
   │
   └── AI
```

Így az AI ténylegesen érti a creator világát.

---

# 27. 🔥 A „FÜGGŐVÉ” TÉTELHEZ szükséges loop

A „függő” alatt én terméktervezési értelemben **magas visszatérési értéket** értenék.

A legerősebb loop szerintem:

```text
CREATE
   ↓
SAVE
   ↓
SHARE
   ↓
FEEDBACK
   ↓
REMIX
   ↓
IMPROVE
   ↓
PUBLISH
   ↓
ANALYZE
   ↓
AI LEARNS
   ↓
CREATE BETTER
   ↓
...
```

Ehhez még:

```text
IDEA
 ↓
PROJECT
 ↓
ASSET
 ↓
AI
 ↓
COLLAB
 ↓
PUBLISH
 ↓
AUDIENCE
 ↓
MARKETPLACE
 ↓
MONEY
 ↓
NEW PROJECT
```

Ez már **nem videóeditor**.

Ez egy creator ecosystem.

---

# 28. Én így priorizálnám a repo következő nagy fejlesztéseit

| Prioritás | Rendszer                    | Miért                                 |
| --------- | --------------------------- | ------------------------------------- |
| 🔴 P0     | **Universal Asset Library** | minden creator közös alapja           |
| 🔴 P0     | **Creator Profile 2.0**     | szerepek + skill + brand + AI         |
| 🔴 P0     | **Workspace rendszer**      | ne csak videóprojekt legyen           |
| 🔴 P0     | **Universal Search / ⌘K**   | minden tartalom megtalálható          |
| 🔴 P0     | **Creative Graph**          | AI és cross-media alap                |
| 🔴 P0     | **Image/Design Studio**     | fotós + designer belépő               |
| 🔴 P0     | **Audio/Music Studio alap** | zenész + producer belépő              |
| 🟠 P1     | **Podcast Studio**          | nagyon jól épül a meglévő audio/AI-ra |
| 🟠 P1     | **Writer Studio**           | új creator-kategória                  |
| 🟠 P1     | **Creator Planner**         | napi visszatérés                      |
| 🟠 P1     | **Creative Collaboration**  | csapatok                              |
| 🟠 P1     | **Creator Analytics**       | feedback loop                         |
| 🟠 P1     | **Marketplace 2.0**         | creator economy                       |
| 🟡 P2     | **Code Studio**             | developer creator                     |
| 🟡 P2     | **Gaming Studio**           | capture + highlights                  |
| 🟡 P2     | **AI Agent Marketplace**    | AI ökoszisztéma                       |
| 🟡 P2     | **Creator Business/CRM**    | teljes creator operating system       |

---

# A legfontosabb változtatás az architektúrában

Én **nem** ezt építeném:

```text
Video Editor
Photo Editor
Audio Editor
Writer
Code Editor
```

mert abból 5 külön app lesz egy appban.

Hanem:

```text
                    ReMix
                      │
                 Creator OS
                      │
 ┌────────────────────┼────────────────────┐
 │                    │                    │
WORKSPACE            ASSETS               AI
 │                    │                    │
PROJECTS          UNIVERSAL LIBRARY    AGENTS
 │                    │                    │
 └────────────────────┼────────────────────┘
                      │
               CREATIVE ENGINE
                      │
       ┌──────────────┼──────────────┐
       │              │              │
      TIME          CANVAS          AUDIO
       │              │              │
      VIDEO         DESIGN         MUSIC
       │              │              │
       └──────────────┼──────────────┘
                      │
               SOCIAL / COLLAB
                      │
               MARKETPLACE
                      │
                PUBLISHING
                      │
                 ANALYTICS
```

### És a creator profil mondja meg:

```text
🎬 Videós
🎨 Designer
🎵 Producer
🎤 Énekes
📸 Fotós
✍️ Író
🎙️ Podcaster
💻 Developer
🎮 Gamer
🤖 AI Creator
```

**nem külön appot kap**, hanem a ReMixből azokat az eszközöket látja előtérben, amelyek neki relevánsak.

---

## És van egy nagyon fontos következtetés a mostani repóból

A **Command Bus + Project Model + Creative Canvas + AI Context + Asset rendszer + Social + Marketplace** kombináció már alkalmas arra, hogy ezt elkezdjétek.

Tehát **nem újra kell írni a ReMixet**.

A jelenlegi videós magot kell **platformmagként absztrahálni**.

A legnagyobb következő technikai lépés ezért szerintem:

```text
Project
    ↓
CreativeDocument
    ↓
Scene / Layer / Track / Asset
    ↓
Commands
    ↓
AI
    ↓
Renderers
```

ahol a `VideoProject` csak **egy dokumentumtípus** lesz a sok közül.

Ekkor például ugyanaz a:

* layer
* transform
* mask
* keyframe
* asset
* version
* command
* AI context
* collaboration
* search
* export

használható **videóban, képen, designban, hangban és később más kreatív dokumentumokban is**.

**Ez az a pont, ahol a ReMix ténylegesen kinőhet a „CapCut konkurens” kategóriából, és egy általános Creator OS-szé válhat.**
