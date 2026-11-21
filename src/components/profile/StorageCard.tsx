import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ExternalStorageSection } from '@/components/profile/storage/ExternalStorageSection';
import { ManualProviderModal } from '@/components/profile/storage/ManualProviderModal';
import { StorageUsageSection } from '@/components/profile/storage/StorageUsageSection';
import { createStorageActions } from '@/components/profile/storage/storageActions';
import { palette } from '@/constants/editor';
import { type ConnectedProvider, fetchConnectedProviders } from '@/lib/externalStorage';
import { creditBalance } from '@/lib/shop';
import { boostMonthlyCost, defaultProviderId, usageFraction } from '@/lib/storageCardOps';
import type { StorageEntry } from '@/lib/storageProviders';
import { type StorageUsage, fetchStorageUsage } from '@/lib/storageQuota';
import { useEntitlement } from '@/store/entitlementStore';
import { logCaught } from '@/lib/logCaught';

/**
 * 🗄️ A tárhely-kártya: a gyökér az állapotot (eredeti hook-sorrendben), a frissítést és a
 * kompozíciót tartja; az akciók a storage/storageActions.ts-ben, a szekciók a storage/ alatt.
 */
export function StorageCard() {
  // 🧭 A bontás után a gyökér már FORDÍTHATÓ lenne (a try/finally-s akciók és a dinamikus
  // import a storageActions-be kerültek), de a memoizálás bekapcsolása viselkedés-változás →
  // külön döntés (tools/reactCompiler.test.js KNOWN_BAILS). Addig szándékosan kimarad.
  'use no memo';
  const { t } = useTranslation();
  const tier = useEntitlement((s) => s.effectiveTier());

  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [providers, setProviders] = useState<ConnectedProvider[]>([]);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // a felhő-tárhely bővítése: +10 GB-os blokkok, havi ismétlődő add-on (PRO-CASH 3.3)
  const [boostBlocks, setBoostBlocks] = useState(1);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [files, setFiles] = useState<StorageEntry[] | null>(null);
  const [manualType, setManualType] = useState<'webdav' | 's3' | null>(null);
  const [manualLabel, setManualLabel] = useState('');
  const [manualCfg, setManualCfg] = useState<Record<string, string>>({});

  // a setState a promise-callbackben történik (halasztott) — így nem „szinkron
  // setState az effektben", és a lista-frissítés akciók után is újrahasználható
  const refresh = useCallback(() => {
    fetchStorageUsage()
      .then((u) => {
        setUsage(u);
        setLoading(false);
      })
      .catch((caught) => {
      logCaught('components/profile/StorageCard.tsx:refresh', caught);
        setUsage(null);
        setLoading(false);
      });
    fetchConnectedProviders().then(setProviders).catch((caught) => { logCaught('components/profile/StorageCard.tsx:refresh', caught); });
    creditBalance().then(setBalance).catch((caught) => { logCaught('components/profile/StorageCard.tsx:refresh', caught); });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const cost = boostMonthlyCost(boostBlocks);
  const pct = usageFraction(usage);
  const barColor = pct >= 0.9 ? palette.danger : palette.accent;
  // az aktív cél: a kijelölt provider, vagy null (= ReMix-tárhely az alap)
  const defaultId = defaultProviderId(providers);

  const { onBuy, onConnectManual, onDisconnect, onSelectTarget, onToggleFiles, startConnect } = createStorageActions({
    t,
    busy,
    setBusy,
    setBalance,
    refresh,
    boostBlocks,
    cost,
    manualType,
    setManualType,
    manualLabel,
    setManualLabel,
    manualCfg,
    setManualCfg,
    expanded,
    setExpanded,
    setFiles,
  });

  return (
    <>
      <StorageUsageSection
        loading={loading}
        usage={usage}
        pct={pct}
        barColor={barColor}
        tier={tier}
        boostBlocks={boostBlocks}
        setBoostBlocks={setBoostBlocks}
        cost={cost}
        balance={balance}
        busy={busy}
        onBuy={onBuy}
      />

      {/* külső tárhelyek */}
      <ExternalStorageSection
        providers={providers}
        defaultId={defaultId}
        busy={busy}
        expanded={expanded}
        files={files}
        onSelectTarget={onSelectTarget}
        onToggleFiles={onToggleFiles}
        onDisconnect={onDisconnect}
        startConnect={startConnect}
      />

      {/* manuális (WebDAV/S3) bekötő űrlap */}
      <ManualProviderModal
        manualType={manualType}
        setManualType={setManualType}
        manualLabel={manualLabel}
        setManualLabel={setManualLabel}
        manualCfg={manualCfg}
        setManualCfg={setManualCfg}
        busy={busy}
        onConnectManual={onConnectManual}
      />
    </>
  );
}
