import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { SECTION_KINDS } from '@/lib/audioMarkers';
import { useEditorStore } from '@/store/editorStore';
import type { Marker } from '@/types/project';

const EMPTY: Marker[] = [];

/** 🔖 a marker műveletei (hosszan nyomva): átnevezés, zenei szakasz, törlés — mind undo-zható */
export function markerActions(m: Marker, t: (k: string, o?: Record<string, unknown>) => string): void {
  const st = useEditorStore.getState();
  const markers = st.project?.markers ?? [];
  const patch = (p: Partial<Marker>) => st.dispatch({ type: 'SET_MARKERS', markers: markers.map((x) => (x.id === m.id ? { ...x, ...p } : x)) });
  const sections = () =>
    Alert.alert(t('studio.audio.markers.section'), undefined, [
      ...SECTION_KINDS.map((s) => ({ text: t(`studio.audio.markers.sections.${s.key}`), onPress: () => patch({ label: t(`studio.audio.markers.sections.${s.key}`), color: s.color }) })),
      { text: t('common.cancel'), style: 'cancel' as const },
    ]);
  const rename = () => {
    if (typeof Alert.prompt !== 'function') {
      sections();
      return;
    }
    Alert.prompt(t('studio.audio.markers.rename'), undefined, (text) => {
      const label = (text ?? '').trim();
      if (label) patch({ label });
    }, 'plain-text', m.label);
  };
  Alert.alert(m.label, undefined, [
    { text: t('studio.audio.markers.rename'), onPress: rename },
    { text: t('studio.audio.markers.section'), onPress: sections },
    { text: t('common.delete'), style: 'destructive', onPress: () => st.dispatch({ type: 'SET_MARKERS', markers: markers.filter((x) => x.id !== m.id) }) },
    { text: t('common.cancel'), style: 'cancel' },
  ]);
}

/**
 * 🔖 A markerek a Hang Stúdió idővonalán: függőleges vonal a teljes magasságon, felül a címke.
 * Koppintás → oda ugrik a lejátszófej; hosszan nyomva → átnevezés / zenei szakasz / törlés.
 */
export function AudioMarkerFlags({ pxPerSec, height }: { pxPerSec: number; height: number }) {
  const { t } = useTranslation();
  const markers = useEditorStore((s) => s.project?.markers) ?? EMPTY;
  return (
    <>
      {markers.map((m) => (
        <View key={`l${m.id}`} pointerEvents="none" style={[styles.line, { left: m.time * pxPerSec, height, backgroundColor: m.color ?? '#ffb454' }]} />
      ))}
      {markers.map((m) => (
        <Pressable
          key={`f${m.id}`}
          testID={`audio-marker-${m.id}`}
          accessibilityRole="button"
          accessibilityLabel={m.label}
          hitSlop={8}
          onPress={() => useEditorStore.getState().setPlayhead(m.time)}
          onLongPress={() => markerActions(m, t)}
          style={[styles.flag, { left: m.time * pxPerSec, backgroundColor: m.color ?? '#ffb454' }]}
        >
          <Text numberOfLines={1} style={styles.label}>
            {m.label}
          </Text>
        </Pressable>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  line: { position: 'absolute', top: 0, width: 1.5, opacity: 0.7 },
  flag: { position: 'absolute', top: 2, paddingHorizontal: 5, paddingVertical: 1, borderTopRightRadius: 4, borderBottomRightRadius: 4, maxWidth: 120 },
  label: { color: '#111', fontSize: 10, fontWeight: '700' },
});
