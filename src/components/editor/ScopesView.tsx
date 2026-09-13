import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { fetchScope, type ScopeType } from '@/lib/colorClient';

const TYPES: ScopeType[] = ['waveform', 'parade', 'vectorscope', 'histogram'];

interface Props {
  /** a mérendő média (a kijelölt klip forrása) */
  uri: string;
  /** a mérendő kocka ideje a forrásban (mp) — a lejátszófejből számolva */
  atSec: number;
}

/**
 * 🩻 Videoszkópok (waveform / RGB-parade / vektorszkóp / hisztogram) — a worker
 * a kijelölt klip AKTUÁLIS kockájáról készít szkóp-képet (nem AI, INGYEN). A
 * mérés kézi (típus-koppintás / ⟳), hogy ne terheljük hívásokkal a lejátszást;
 * a ⟳ mindig az épp aktuális lejátszófej-pozíción mér.
 */
export function ScopesView({ uri, atSec }: Props) {
  const { t } = useTranslation();
  const [type, setType] = useState<ScopeType>('waveform');
  const [img, setImg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = async (nextType: ScopeType) => {
    setBusy(true);
    setFailed(false);
    const data = await fetchScope(uri, atSec, nextType);
    setBusy(false);
    if (data) {
      setImg(data);
    } else {
      setImg(null);
      setFailed(true);
    }
  };

  return (
    <View>
      <View style={styles.tabs}>
        {TYPES.map((tp) => {
          const on = type === tp;
          return (
            <Pressable
              key={tp}
              onPress={() => {
                setType(tp);
                void load(tp);
              }}
              hitSlop={4}
              style={[styles.tab, on ? styles.tabOn : null]}
            >
              <Text style={[styles.tabText, on ? styles.tabTextOn : null]}>
                {t('panels.adjust.scope_' + tp)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.stage}>
        {busy ? (
          <ActivityIndicator color={palette.accent} />
        ) : img ? (
          <Image source={{ uri: img }} style={styles.img} resizeMode="contain" />
        ) : (
          <Text style={styles.hint}>
            {failed ? t('panels.adjust.scopeFail') : t('panels.adjust.scopeHint')}
          </Text>
        )}
      </View>
      <Pressable onPress={() => void load(type)} hitSlop={6} style={styles.refresh}>
        <Text style={styles.refreshText}>⟳ {t('panels.adjust.scopeRefresh')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
  },
  tab: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  tabOn: {
    borderColor: palette.accent,
    backgroundColor: palette.accentSoft,
  },
  tabText: {
    fontSize: 11,
    fontWeight: '700',
    color: palette.textDim,
  },
  tabTextOn: {
    color: palette.accent,
  },
  stage: {
    height: 200,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  img: {
    width: '100%',
    height: '100%',
  },
  hint: {
    color: palette.textDim,
    fontSize: 11,
    paddingHorizontal: 16,
    textAlign: 'center',
  },
  refresh: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingVertical: 4,
  },
  refreshText: {
    color: palette.text,
    fontSize: 12,
    fontWeight: '700',
  },
});
