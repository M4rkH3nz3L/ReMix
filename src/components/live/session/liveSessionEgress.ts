import type { TFunction } from 'i18next';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { Alert } from 'react-native';

import { hasEnabledTargets, startLiveEgress, stopLiveEgress } from '@/lib/liveDestinations';
import { egressFailure, type EgressStatus } from '@/lib/liveState';
import { logCaught } from '@/lib/logCaught';
import type { Project } from '@/types/project';

/**
 * 📡 Az élő adás stream-konfigurációja: a host szerveres egressének indítása (multistream /
 * felhős felvétel, Pro) — REFACTOR: a src/app/live/[id].tsx session-effektjéből, változatlan
 * lánccal; az `active` zárlat-változót az `isActive()` olvassa. A logCaught-címke az eredeti.
 */

export interface HostEgressDeps {
  liveId: string;
  wantRecord: boolean;
  aspectRatio: Project['aspectRatio'];
  /** a session-effekt még él-e (a cleanup hamisra állítja) */
  isActive: () => boolean;
  endedRef: RefObject<boolean>;
  egressIdRef: RefObject<string | null>;
  vodUrlRef: RefObject<string | null>;
  setEgress: Dispatch<SetStateAction<EgressStatus>>;
  tRef: RefObject<TFunction>;
}

export function startHostEgress({
  liveId,
  wantRecord,
  aspectRatio,
  isActive,
  endedRef,
  egressIdRef,
  vodUrlRef,
  setEgress,
  tRef,
}: HostEgressDeps): void {
          hasEnabledTargets()
            .then((has) => {
              if (!(has || wantRecord) || !isActive()) return null;
              setEgress({ state: 'starting' });
              return startLiveEgress(liveId, wantRecord, aspectRatio);
            })
            .then((r) => {
              if (!r) return;
              if (!isActive() || endedRef.current) {
                // 🔐 L15: az adás közben véget ért → az árva egresst AZONNAL leállítjuk
                void stopLiveEgress(r.egressId);
                return;
              }
              egressIdRef.current = r.egressId;
              vodUrlRef.current = r.vodUrl ?? null; // 📼 D158: felvett VOD (ha van)
              setEgress({ state: 'on', destinations: r.destinations.length, recording: !!r.vodUrl, skipped: r.skipped?.length ?? 0 });
              if (r.skipped?.length) {
                Alert.alert(tRef.current('live.egress.title'), tRef.current('live.egress.skipped', { names: r.skipped.map((d) => d.label).join(', ') }));
              }
            })
            .catch((e: Error) => {
            logCaught('app/live/[id].tsx:LiveRoomScreen', e);
              // L17: a hiba LÁTHATÓ (eddig elnyelve → a host azt hitte, multistreamel)
              const reason = egressFailure(String(e?.message ?? ''), wantRecord);
              setEgress({ state: 'failed', reason });
              if (isActive()) Alert.alert(tRef.current('live.egress.title'), tRef.current(`live.egress.reason_${reason}`));
            });
}
