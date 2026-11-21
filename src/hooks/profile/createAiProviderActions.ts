import type { TFunction } from 'i18next';
import type { Dispatch, SetStateAction } from 'react';
import { Alert } from 'react-native';

import {
  type AiProvider,
  type AiTask,
  createAiProvider,
  deleteAiProvider,
  setDefaultAiProvider,
  setTaskAssignment,
  updateAiProvider,
} from '@/lib/aiProviders';
import { examineProvider } from '@/lib/aiExamClient';
import { randomAvatar } from '@/lib/avatar';
import { generatePersona } from '@/lib/aiPersona';
import {
  EMPTY_FORM,
  type ProviderForm,
  providerFormFromProvider,
  providerFormValidity,
  providerInputFromForm,
} from '@/hooks/profile/providerForm';
import { logCaught } from '@/lib/logCaught';

/**
 * 🤖 Az AI-modellek kezelése (REFACTOR: a useProfile-ból) — hook-mentes csoport, minden renderben
 * újra létrehozva: szerkesztő-űrlap nyitása/mentése, törlés, alapértelmezés, feladat-hozzárendelés,
 * persona-generátor.
 */
export function createAiProviderActions({
  form,
  setForm,
  setEditorOpen,
  savingProvider,
  setSavingProvider,
  setTaskAssign,
  refresh,
  t,
}: {
  form: ProviderForm;
  setForm: Dispatch<SetStateAction<ProviderForm>>;
  setEditorOpen: Dispatch<SetStateAction<boolean>>;
  savingProvider: boolean;
  setSavingProvider: Dispatch<SetStateAction<boolean>>;
  setTaskAssign: Dispatch<SetStateAction<Partial<Record<AiTask, string>>>>;
  refresh: () => void;
  t: TFunction;
}) {
  // — AI-modellek —
  const openNew = () => {
    setForm(EMPTY_FORM);
    setEditorOpen(true);
  };
  const openEdit = (p: AiProvider) => {
    setForm(providerFormFromProvider(p));
    setEditorOpen(true);
  };

  const { kindMeta, formValid } = providerFormValidity(form);

  const saveProviderAsync = async () => {
    if (!formValid || savingProvider) {
      return;
    }
    setSavingProvider(true);
    const input = providerInputFromForm(form);
    try {
      let saved: AiProvider;
      if (form.id) {
        await updateAiProvider(form.id, input);
        saved = { id: form.id, isDefault: false, ...input };
      } else {
        saved = await createAiProvider(input);
      }
      setEditorOpen(false);
      refresh();
      // 🧪 feladat-vizsga (local-ai 5.3) a háttérben: a modell feladatonként
      // bevizsgázik, és csak a sikeres feladataira lesz fogható; az eredmény
      // beérkeztekor a lista újratölt (a kártya 🧪 n/6 jelvénye frissül)
      void examineProvider(saved).then(() => refresh());
    } catch (e) {
      logCaught('hooks/useProfile.ts:saveProviderAsync', e);
      Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e));
    } finally {
      setSavingProvider(false);
    }
  };
  // a provider-mentés is szinkron (void) handler a UI felé
  const onSaveProvider = () => {
    void saveProviderAsync();
  };

  const onDeleteProvider = (p: AiProvider) => {
    Alert.alert(p.label, t('profile.deleteModelConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          deleteAiProvider(p.id)
            .then(() => refresh())
            .catch((e: Error) => { logCaught('hooks/useProfile.ts:onDeleteProvider', e); return Alert.alert(t('common.error'), e.message); });
        },
      },
    ]);
  };

  const onSetDefault = (p: AiProvider) => {
    if (p.isDefault) {
      return;
    }
    setDefaultAiProvider(p.id)
      .then(() => refresh())
      .catch((e: Error) => { logCaught('hooks/useProfile.ts:onSetDefault', e); return Alert.alert(t('common.error'), e.message); });
  };

  // 🤖 feladat → provider választás (Auto = null); optimista + perzisztálva
  const pickTask = (task: AiTask, providerId: string | null) => {
    setTaskAssign((prev) => {
      const next = { ...prev };
      if (providerId) {
        next[task] = providerId;
      } else {
        delete next[task];
      }
      return next;
    });
    setTaskAssignment(task, providerId).catch((e: Error) =>
      { logCaught('hooks/useProfile.ts:pickTask', e); return Alert.alert(t('common.error'), e.message); }
    );
  };

  // 🧑‍🎨 persona-generátor az űrlapon (a „Generálás" gombhoz)
  const generateFormPersona = () => {
    const p = generatePersona(form.capabilities);
    setForm((f) => ({
      ...f,
      // csak akkor ad nevet, ha még nincs — a beírt nevet (pl. GYP) megőrzi
      label: f.label.trim() ? f.label : p.name,
      personaStory: p.story,
      avatar: randomAvatar(),
    }));
  };

  return {
    openNew,
    openEdit,
    kindMeta,
    formValid,
    onSaveProvider,
    onDeleteProvider,
    onSetDefault,
    pickTask,
    generateFormPersona,
  };
}
