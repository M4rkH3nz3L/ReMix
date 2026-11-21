import { useState } from 'react';

import type { AiProvider, AiTask } from '@/lib/aiProviders';
import { type AccountProfile, emptyProfile } from '@/lib/profile';
import type { SubscriptionDetails } from '@/lib/subscription';
import { EMPTY_FORM, type ProviderForm } from '@/hooks/profile/providerForm';

/** 🗃️ A profil-képernyő adat- és űrlap-állapota (REFACTOR: a useProfile-ból, az eredeti sorrendben). */
export function useProfileState(configured: boolean) {
  const [sub, setSub] = useState<SubscriptionDetails | null>(null);
  // a dátum-kijelzéseket effektben számoljuk (a render TISZTA marad — react-hooks/purity)
  const [proMeta, setProMeta] = useState<{ untilText: string; updatedText: string | null }>({
    untilText: '',
    updatedText: null,
  });

  // configured=false esetén nincs mit tölteni → azonnal false (nem villog a spinner)
  const [loading, setLoading] = useState(configured);
  const [profile, setProfile] = useState<AccountProfile>(() => emptyProfile());
  const [savingProfile, setSavingProfile] = useState(false);
  const [providers, setProviders] = useState<AiProvider[]>([]);
  // 🤖 feladat → provider hozzárendelések (a „AI-modellek feladatonként" mátrixhoz)
  const [taskAssign, setTaskAssign] = useState<Partial<Record<AiTask, string>>>({});

  const [form, setForm] = useState<ProviderForm>(EMPTY_FORM);
  const [editorOpen, setEditorOpen] = useState(false);
  const [savingProvider, setSavingProvider] = useState(false);
  return {
    sub,
    setSub,
    proMeta,
    setProMeta,
    loading,
    setLoading,
    profile,
    setProfile,
    savingProfile,
    setSavingProfile,
    providers,
    setProviders,
    taskAssign,
    setTaskAssign,
    form,
    setForm,
    editorOpen,
    setEditorOpen,
    savingProvider,
    setSavingProvider,
  };
}
