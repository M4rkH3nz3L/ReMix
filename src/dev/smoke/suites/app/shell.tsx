/** 🧪 Füstteszt — app-keret: belépés, menük, gesztus-képernyők, újabb séma. (Áthelyezve: phases03, phases09; viselkedés-változás nélkül.) */
import type { ReactNode } from 'react';
import { Platform, Dimensions, View } from 'react-native';
import { loginWithIdentifier } from '@/lib/loginIdentifier';
import { useActionMenu } from '@/store/actionMenuStore';
import { LayerMenuSheet } from '@/components/studio/image/LayerMenuSheet';
import { LiveQuickGrid } from '@/components/live/LiveQuickGrid';
import { MultiSelectBar } from '@/components/studio/image/body/MultiSelectBar';
import { router, type Href } from 'expo-router';
import { createEmptyProject, CURRENT_SCHEMA_VERSION } from '@/lib/projectUtils';
import { saveProject, deleteProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { ImageLayer } from '@/types/project';
import { type Log, sleep } from '../../helpers/core';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logCaught } from '@/lib/logCaught';
import '@/lib/dspNativeClient';

/** A gesztus-terület a valódi képernyőkön: megnyílnak, és a tárolóban él az undo-lánc. */
export async function smokeGestureScreens(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  for (const [kind, path] of [['video', '/editor'], ['audio', '/studio/audio'], ['live', '/live/studio']] as const) {
    const project = createEmptyProject(`smoke gesztus ${kind}`, '9:16', undefined, kind);
    await saveProject(project);
    const start = performance.now();
    router.push(`${path}/${project.id}` as Href);
    for (let i = 0; i < 100 && useEditorStore.getState().project?.id !== project.id; i++) {
      await sleep(200);
    }
    const open = useEditorStore.getState().project;
    log(open?.id === project.id, `${kind}: a képernyő megnyílt a gesztus-területtel`, `${Math.round(performance.now() - start)} ms`);
    await sleep(1000);
    router.back();
    await sleep(1500);
    await deleteProject(project.id);
  }
}
/** A hosszú nyomás menüje és a többes sáv a kijelzőn. */
export async function smokeMenus(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const layer = { kind: 'shape', id: 'm', shape: 'rectangle', position: { x: 0.5, y: 0.5 }, w: 0.4, h: 0.4, fill: '#fff' } as ImageLayer;
  setHarness(
    <View style={{ width: Math.min(420, Dimensions.get('window').width) }}>
      <MultiSelectBar count={3} onAction={() => {}} onClose={() => {}} />
      <LiveQuickGrid sources={[{ id: 'k', kind: 'camera', label: 'Kamera', visible: true }, { id: 'l', kind: 'logo', label: 'Logó', visible: false }, { id: 't', kind: 'text', label: 'Felirat', visible: true }]} micMuted={false} onToggle={() => {}} onMic={() => {}} onFlip={() => {}} />
      <LayerMenuSheet layer={layer} onPick={() => {}} onClose={() => {}} />
    </View>
  );
  await sleep(1500);
  log(true, 'FOTÓZHATÓ', 'menü és többes sáv');
  await sleep(6000);
  setHarness(null);
}
/** A hosszú nyomás menüje a gyökérből, a valódi Modal-lal. */
export async function smokeActionMenu(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  useActionMenu.getState().open('Videó', [
    { label: 'Több kijelölése', icon: 'checkmark-done-outline', onPress: () => {} },
    { label: 'Vágás itt', icon: 'cut-outline', onPress: () => {} },
    { label: 'Duplikálás', icon: 'copy-outline', onPress: () => {} },
    { label: 'Törlés', icon: 'trash-outline', destructive: true, onPress: () => {} },
  ]);
  await sleep(1200);
  log(useActionMenu.getState().items?.length === 4, 'a menü nyitva', '4 elem');
  log(true, 'FOTÓZHATÓ', 'menülap');
  await sleep(5000);
  useActionMenu.getState().close();
  await sleep(500);
}
/** Belépés azonosítóval a valódi hálózaton: a válasz nem különbözteti meg az ismeretlen fiókot. */
export async function smokeLogin(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const out = await loginWithIdentifier('nincs_ilyen_felhasznalo', 'rossz-jelszo');
  log('error' in out && out.error === 'invalidCredentials', 'ismeretlen azonosító: általános hiba', JSON.stringify(out));
}
/** 📐 AP1: az újabb app-verzió projektje csak olvasható — a szerkesztés nem megy át, a tárolt bájtok változatlanok. */
export async function smokeNewerSchema(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const id = 'prj_smoke_newer';
  const key = `vided.project.v1.${id}`;
  const base = createEmptyProject('smoke újabb séma', '9:16', undefined, 'audio');
  const stored = { ...base, id, schemaVersion: 99, futureField: { x: 1 } };
  const raw = JSON.stringify(stored);
  await AsyncStorage.setItem(key, raw);
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1500);
  const opened = st().project?.id === id && st().project?.schemaVersion === 99;
  const ok = st().dispatch({ type: 'RENAME_PROJECT', name: 'felülírva' });
  log(opened && !ok && st().project?.name === base.name, 'a v99-es projekt megnyílik, a szerkesztés nem megy át', `séma ${st().project?.schemaVersion}, dispatch ${ok}`);
  log(true, 'FOTÓZHATÓ', 'a „csak olvasható” sáv a Hang Stúdió tetején');
  await sleep(2500);
  router.back();
  await sleep(1500); // a kilépéskori mentés is lefut
  const after = await AsyncStorage.getItem(key);
  log(after === raw, 'kilépés után a tárolt projekt bájtra változatlan (az ismeretlen mező is megmaradt)', `${raw.length} bájt`);
  await AsyncStorage.removeItem(key);
  // a mai projekt a jelenlegi sémával mentődik
  const cur = { ...createEmptyProject('smoke v7', '9:16', undefined, 'audio'), id: 'prj_smoke_v7' };
  await saveProject(cur);
  const back = JSON.parse((await AsyncStorage.getItem('vided.project.v1.prj_smoke_v7')) ?? '{}') as { schemaVersion?: number };
  log(back.schemaVersion === CURRENT_SCHEMA_VERSION, `az új projekt a jelenlegi sémán (v${CURRENT_SCHEMA_VERSION}) mentődik`, `v${back.schemaVersion}`);
  await deleteProject('prj_smoke_v7').catch((caught) => logCaught('lib/imageSmoke.tsx:newerschema', caught));
}
