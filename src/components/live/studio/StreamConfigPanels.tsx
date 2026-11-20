import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { RecordToggle } from '@/components/live/RecordToggle';
import { EXTERNAL_PLATFORMS } from '@/components/live/studio/liveStudioConstants';
import { shared } from '@/components/live/studio/liveStudioStyles';
import { palette } from '@/constants/editor';
import { capabilityAllowed } from '@/lib/capabilities';
import { makeId } from '@/lib/id';
import { addDestination, setRecord, toggleDestination } from '@/lib/liveDoc';
import type { LiveDestinationRow } from '@/lib/liveDestinations';
import { useEntitlement } from '@/store/entitlementStore';
import { usePaywall } from '@/store/paywallStore';
import type { LiveDoc } from '@/types/live';

/**
 * 📡 Az adás-konfiguráció panelei (REFACTOR: a src/app/live/studio/[id].tsx-ből):
 * a dokumentum célplatformjai, a felhős rögzítés és a multistream RTMP-célok.
 */

export interface DocPanelProps {
  live: LiveDoc;
  commit: (next: LiveDoc, label?: string) => void;
}

/** célok: a ReMix-feed mindig él, a külső platformok be/ki és hozzáadás */
export function DestinationsPanel({ live, commit }: DocPanelProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* célok */}
      <Text style={shared.sectionLabel}>{t('live.studio.destinations', { defaultValue: 'Destinations' })}</Text>
      <View style={styles.destRow}>
        {live.destinations.map((d) => (
          <Pressable
            key={d.id}
            onPress={() => d.platform !== 'remix' && commit(toggleDestination(live, d.id))}
            style={[styles.destChip, d.enabled && styles.destChipOn, d.platform === 'remix' && styles.destChipLocked]}
          >
            <Text style={[styles.destChipText, d.enabled && styles.destChipTextOn]}>{d.label}</Text>
            {d.platform !== 'remix' && !d.enabled && (
              <Text style={styles.destPro}>Pro</Text>
            )}
          </Pressable>
        ))}
        {EXTERNAL_PLATFORMS.filter(
          (p) => !live.destinations.some((d) => d.platform === p.platform)
        ).map((p) => (
          <Pressable
            key={p.platform}
            onPress={() =>
              commit(addDestination(live, p.platform, p.label, () => makeId('ldst'), { enabled: true }))
            }
            style={[styles.destChip, styles.destChipAdd]}
          >
            <Ionicons name="add" size={14} color={palette.accent} />
            <Text style={styles.destChipText}>{p.label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={shared.hint}>{t('live.studio.destHint', { defaultValue: 'ReMix feed is always on. External platforms are Pro (multistream).' })}</Text>
    </>
  );
}

/** 📼 felhős rögzítés kapcsoló (Pro) */
export function RecordPanel({ live, commit }: DocPanelProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* 📼 Rögzítés: BE → az adás végén a teljes felvételből szerkeszthető video-projekt;
          KI → NINCS projekt (a live csak élő adás, nem keletkezik üres-projekt). */}
      <Text style={shared.sectionLabel}>{t('live.studio.recordSection', { defaultValue: 'Rögzítés' })}</Text>
      <RecordToggle
        value={!!live.record}
        onToggle={() => {
          // 💳 L18: a felhős felvétel Pro (szerveres egress) — Free usernél a Pro-ajánlat,
          // nem egy csendben elbukó (402) „rögzítés" ígéret
          if (!live.record && !capabilityAllowed('liveCloud', useEntitlement.getState().effectiveTier())) {
            usePaywall.getState().open('liveCloud');
            return;
          }
          commit(setRecord(live, !live.record), live.record ? 'record-off' : 'record-on');
        }}
      />
    </>
  );
}

export interface MultistreamPanelProps {
  dests: LiveDestinationRow[];
  onOpenRtmp: () => void;
  onToggleDest: (d: LiveDestinationRow) => void;
  onRemoveDest: (d: LiveDestinationRow) => void;
}

/** 🎥 Multistream RTMP-célok (Pro) — a tényleges ingest-URL + kulcs */
export function MultistreamPanel({ dests, onOpenRtmp, onToggleDest, onRemoveDest }: MultistreamPanelProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* 🎥 Multistream RTMP-célok (Pro) — a tényleges ingest-URL + kulcs */}
      <View style={shared.rowBetween}>
        <Text style={shared.sectionLabel}>{t('live.studio.multistream', { defaultValue: 'Multistream (Pro)' })}</Text>
        <Pressable onPress={onOpenRtmp} style={shared.addSourceBtn} hitSlop={8}>
          <Ionicons name="add" size={16} color={palette.accent} />
          <Text style={shared.addSourceText}>RTMP</Text>
        </Pressable>
      </View>
      {dests.length === 0 ? (
        <Text style={shared.hint}>
          {t('live.studio.noRtmp', { defaultValue: 'Add a YouTube/TikTok/Twitch/custom RTMP target to multistream. ReMix feed is always on.' })}
        </Text>
      ) : (
        dests.map((d) => (
          <View key={d.id} style={styles.destManageRow}>
            <Pressable
              onPress={() => {
                onToggleDest(d);
              }}
              hitSlop={6}
            >
              <Ionicons
                name={d.enabled ? 'checkmark-circle' : 'ellipse-outline'}
                size={20}
                color={d.enabled ? palette.accent : palette.textDim}
              />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={styles.destManageLabel} numberOfLines={1}>{d.label}</Text>
              <Text style={styles.destManageUrl} numberOfLines={1}>{d.rtmpUrl} · {d.hasKey ? '•••• key' : t('live.studio.noKey', { defaultValue: 'no key' })}</Text>
            </View>
            <Pressable onPress={() => onRemoveDest(d)} hitSlop={6}>
              <Ionicons name="trash-outline" size={17} color={palette.danger} />
            </Pressable>
          </View>
        ))
      )}
    </>
  );
}

const styles = StyleSheet.create({
  destRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  destChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: palette.surface,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  destChipOn: { borderColor: palette.accent, backgroundColor: palette.accent + '22' },
  destChipLocked: { opacity: 0.9 },
  destChipAdd: { borderStyle: 'dashed', borderColor: palette.border },
  destChipText: { color: palette.text, fontSize: 13, fontWeight: '700' },
  destChipTextOn: { color: palette.accent },
  destPro: { color: palette.textDim, fontSize: 10, fontWeight: '800' },

  destManageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: palette.surface,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  destManageLabel: { color: palette.text, fontSize: 14, fontWeight: '700' },
  destManageUrl: { color: palette.textDim, fontSize: 11, marginTop: 1 },
});
