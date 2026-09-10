// 🧊 3D stickers (3D V1): CC0 glTF modellek (assets/stickers3d/, licencek a
// LICENSES.md-ben) → three.js render a Chromium headless shellben → átlátszó
// hátterű PNG. A kliens a PNG-t kép-kitöltésű formaként (logó-útvonal) teszi a
// vászonra — húzható, méretezhető, trackinggel követtethető, a renderbe beég.
//
// A szög (yaw/pitch) paraméterezhető → ugyanaz a modell több nézetből is
// kérhető; az eredmény fájl-cache-be kerül (assets/stickers3d/cache/).
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const STICKER_DIR = path.join(__dirname, 'assets', 'stickers3d');
const CACHE_DIR = path.join(STICKER_DIR, 'cache');
const THREE_DIR = path.join(__dirname, 'node_modules', 'three');

/** a beépített csomag — mind CC0 (lásd LICENSES.md) */
const STICKERS3D = [
  { id: 'avocado', label: '🥑 Avokádó', file: 'Avocado.glb' },
  { id: 'boombox', label: '📻 Boombox', file: 'BoomBox.glb' },
  { id: 'lantern', label: '🏮 Lámpás', file: 'Lantern.glb' },
  { id: 'waterbottle', label: '🧴 Kulacs', file: 'WaterBottle.glb' },
  { id: 'corset', label: '🎀 Fűző', file: 'Corset.glb' },
  { id: 'toycar', label: '🏎️ Játékautó', file: 'ToyCar.glb' },
];

function stickers3dAvailable() {
  return (
    fs.existsSync(path.join(THREE_DIR, 'build', 'three.module.js')) &&
    STICKERS3D.some((s) => fs.existsSync(path.join(STICKER_DIR, s.file)))
  );
}

function listStickers3d() {
  return STICKERS3D.filter((s) => fs.existsSync(path.join(STICKER_DIR, s.file)));
}

function findChromium() {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) {
    return process.env.CHROMIUM_PATH;
  }
  const cache = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  try {
    const dirs = fs
      .readdirSync(cache)
      .filter((d) => d.startsWith('chromium_headless_shell-'))
      .sort()
      .reverse();
    for (const dir of dirs) {
      const bin = path.join(cache, dir, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell');
      if (fs.existsSync(bin)) {
        return bin;
      }
    }
  } catch {
    // nincs playwright-cache
  }
  return null;
}

/**
 * A render-oldal HTML-je — importmap a lokális three-re, a modell file:// URL-ről
 * töltődik. FONTOS: az oldalt fájlból kell megnyitni (page.goto file://…) —
 * setContent-tel az origin about:blank lenne, és a file:// modul-import
 * cross-origin hibára futna a --allow-file-access-from-files flag ellenére is.
 */
/** anyag-presetek: a modell eredeti anyagát felülíró felületek */
const MATERIALS = {
  original: null,
  chrome: { metalness: 1, roughness: 0.08, color: 0xffffff },
  gold: { metalness: 1, roughness: 0.22, color: 0xffd166 },
  glass: { metalness: 0, roughness: 0.05, color: 0xbfe9ff, transparent: true, opacity: 0.55 },
  matte: { metalness: 0, roughness: 0.9, color: 0xf2f2f2 },
};

/** környezet-presetek: a RoomEnvironment tónusa + háttér-fény ereje */
const ENVIRONMENTS = {
  studio: { intensity: 1.0, tint: 0xffffff },
  sunset: { intensity: 1.15, tint: 0xffb37a },
  night: { intensity: 0.55, tint: 0x8fb6ff },
  neon: { intensity: 1.25, tint: 0xff6bd6 },
};

function stickerHtml(glbFileUrl, { yaw, pitch, size, material, environment, shadow }) {
  return `<!doctype html><html><head><meta charset="utf-8">
<script type="importmap">{"imports":{
  "three":"file://${THREE_DIR}/build/three.module.js",
  "three/addons/":"file://${THREE_DIR}/examples/jsm/"
}}</script>
<style>html,body{margin:0;background:transparent}canvas{display:block}</style>
</head><body>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

window.addEventListener('error', (e) => { document.title = 'error:' + e.message; });

const SIZE = ${size};
const SHADOW = ${shadow};
const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
renderer.setSize(SIZE, SIZE);
if (SHADOW) {
  // lágy kontakt-árnyék: a ShadowMaterial CSAK az árnyékot rajzolja, a sík
  // egyébként átlátszó marad — így a PNG alfája sértetlen, a matrica bármilyen
  // háttér fölé tehető, és mégis „leül" a felületre
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// semleges stúdió-környezet a PBR-anyagokhoz (nincs külön HDRI-fájl)
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
// környezet-preset: fény-erő + színezett kulcsfény (HDRI-fájl nélkül)
const ENV = ${JSON.stringify(ENVIRONMENTS)}['${environment}'] || { intensity: 1, tint: 0xffffff };
scene.environmentIntensity = ENV.intensity;
const key = new THREE.DirectionalLight(ENV.tint, 1.6 * ENV.intensity);
key.position.set(2, 3, 4);
key.castShadow = SHADOW;
scene.add(key);
const rim = new THREE.DirectionalLight(ENV.tint, 0.8 * ENV.intensity);
rim.position.set(-3, 1, -2);
scene.add(rim);
const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 100);

// a three FileLoader-e fetch()-et használ, ami file://-n tiltott — az XHR-re
// viszont érvényes a --allow-file-access-from-files, azzal olvassuk a glb-t
const xhr = new XMLHttpRequest();
xhr.open('GET', '${glbFileUrl}');
xhr.responseType = 'arraybuffer';
xhr.onerror = () => { document.title = 'error:xhr'; };
xhr.onload = () => new GLTFLoader().parse(xhr.response, '', (gltf) => {
  const obj = gltf.scene;
  // anyag-felülírás (chrome/gold/glass/matte) — az 'original' érintetlen hagyja
  const MAT = ${JSON.stringify(MATERIALS)}['${material}'];
  if (MAT) {
    obj.traverse((n) => {
      if (n.isMesh) {
        n.material = new THREE.MeshPhysicalMaterial({
          color: MAT.color, metalness: MAT.metalness, roughness: MAT.roughness,
          transparent: !!MAT.transparent, opacity: MAT.opacity ?? 1,
          clearcoat: MAT.metalness > 0.5 ? 0.6 : 0,
        });
      }
    });
  }
  // a kért nézet: a MODELL forog (a kamera fixen néz)
  obj.rotation.y = ${yaw} * Math.PI / 180;
  obj.rotation.x = ${pitch} * Math.PI / 180;
  scene.add(obj);
  // keretezés a forgatás UTÁNI befoglaló doboz alapján
  const box = new THREE.Box3().setFromObject(obj);
  const center = box.getCenter(new THREE.Vector3());
  const sphere = box.getBoundingSphere(new THREE.Sphere());

  if (SHADOW) {
    // ÖN-ÁRNYÉKOLÁS: a modell részei egymásra vetnek árnyékot (a lámpás
    // bordái, a kocsi a leplen…) — ettől kap valódi térbeli mélységet.
    //
    // Földsíkot SZÁNDÉKOSAN NEM teszünk alá: a matrica videó fölé kerül, ahol
    // nincs padló, a kamera pedig vízszintesen néz, így a vízszintes síkot
    // élből látná — vékony csíkot adna, nem árnyékot. A „felületre ül"
    // hatáshoz a forma-réteg meglévő 🌒 árnyék-kapcsolója való (sziluettet
    // követő drop-shadow), ami a 3D matricákon is működik.
    obj.traverse((nd) => {
      if (nd.isMesh) {
        nd.castShadow = true;
        nd.receiveShadow = true;
      }
    });
    const r = sphere.radius * 1.6;
    key.shadow.camera.left = -r; key.shadow.camera.right = r;
    key.shadow.camera.top = r; key.shadow.camera.bottom = -r;
    key.shadow.camera.near = 0.01; key.shadow.camera.far = sphere.radius * 16;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0015; // a felület önmagára vetett zaja (shadow acne) ellen
    key.position.set(
      center.x + sphere.radius * 2.2,
      center.y + sphere.radius * 2.6,
      center.z + sphere.radius * 2.2
    );
    key.target.position.copy(center);
    scene.add(key.target);
    key.shadow.camera.updateProjectionMatrix();
  }

  const dist = sphere.radius / Math.sin((camera.fov / 2) * Math.PI / 180) * 1.12;
  camera.position.set(center.x, center.y, center.z + dist);
  camera.lookAt(center);
  renderer.render(scene, camera);
  window.__png = renderer.domElement.toDataURL('image/png');
  document.title = 'done';
}, (err) => {
  document.title = 'error:' + ((err && err.message) || 'betöltés');
});
xhr.send();
</script></body></html>`;
}

let browserPromise = null;
async function getBrowser() {
  if (!browserPromise) {
    const { chromium } = require('playwright-core');
    const executablePath = findChromium();
    if (!executablePath) {
      throw new Error('Nincs Chromium headless shell (playwright cache).');
    }
    // a file:// importmap miatt kell a fájl-hozzáférés engedélyezése
    browserPromise = chromium.launch({
      executablePath,
      args: ['--allow-file-access-from-files'],
    });
  }
  return browserPromise;
}

/**
 * 3D sticker render PNG-be (fájl-cache-elve).
 * @returns {Promise<string>} a PNG útvonala
 */
async function renderSticker3d(id, opts = {}) {
  const spec = STICKERS3D.find((s) => s.id === id);
  if (!spec) {
    throw new Error(`Ismeretlen 3D sticker: ${id}`);
  }
  const yaw = Math.max(-180, Math.min(180, Math.round(opts.yaw ?? -30)));
  const pitch = Math.max(-60, Math.min(60, Math.round(opts.pitch ?? 8)));
  const size = Math.max(128, Math.min(1024, Math.round(opts.size ?? 640)));
  const material = MATERIALS[opts.material] !== undefined ? opts.material : 'original';
  const environment = ENVIRONMENTS[opts.environment] ? opts.environment : 'studio';
  const shadow = opts.shadow !== false && opts.shadow !== 'false' && opts.shadow !== '0';
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const out = path.join(
    CACHE_DIR,
    `${id}_${yaw}_${pitch}_${size}_${material}_${environment}${shadow ? '_sh' : ''}.png`
  );
  if (fs.existsSync(out)) {
    return out;
  }

  const glbUrl = `file://${path.join(STICKER_DIR, spec.file)}`;
  const html = stickerHtml(glbUrl, { yaw, pitch, size, material, environment, shadow });
  const htmlFile = path.join(
    CACHE_DIR,
    `render_${id}_${yaw}_${pitch}_${size}_${material}_${environment}${shadow ? '_sh' : ''}.html`
  );
  fs.writeFileSync(htmlFile, html);
  const browser = await getBrowser();
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  try {
    await page.goto(`file://${htmlFile}`, { waitUntil: 'load' });
    await page.waitForFunction(
      () => document.title === 'done' || document.title.startsWith('error:'),
      { timeout: 30000 }
    );
    const title = await page.title();
    if (title.startsWith('error:')) {
      throw new Error(`glTF-betöltés hiba: ${title.slice(6)}`);
    }
    const dataUrl = await page.evaluate(() => window.__png);
    if (!dataUrl || !dataUrl.startsWith('data:image/png')) {
      throw new Error('A 3D render nem adott képet (WebGL?).');
    }
    fs.writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
    return out;
  } finally {
    await page.close();
    fs.rm(htmlFile, { force: true }, () => {});
  }
}

module.exports = {
  STICKERS3D,
  MATERIALS,
  ENVIRONMENTS,
  listStickers3d,
  renderSticker3d,
  stickers3dAvailable,
};
