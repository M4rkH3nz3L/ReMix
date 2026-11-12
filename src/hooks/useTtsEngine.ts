import { useEffect, useState } from 'react';

import { logCaught } from '@/lib/logCaught';
import { fetchTtsVoices, generateTts } from '@/lib/tts';
import { deviceVoices, speakToFile, type DeviceVoice } from '@/lib/ttsOnDevice';

/** egy választható hang a felületen */
export interface TtsChoice {
  key: string;
  label: string;
}

/**
 * 🗣️ Az AI-hang (TTS) közös motorja a Hang Stúdió lapjának és a videó-szerkesztő hang-paneljének:
 * ha a telefonon van beszédhang, a telefon dolgozik (offline, minden szinten — `needsPro: false`);
 * különben a szerveres hangok (Pro — a hívó `guardPro`-val indítja). Egy helyen, hogy a két felület
 * ugyanúgy viselkedjen.
 */
export function useTtsEngine(appLang: string) {
  const [device, setDevice] = useState<DeviceVoice[] | null>(null);
  const [server, setServer] = useState<{ name: string; locale: string }[]>([]);
  const [serverAvailable, setServerAvailable] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<string | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    void deviceVoices(appLang).then((list) => {
      if (!alive) return;
      setDevice(list);
      if (list.length > 0) {
        setSelected((s) => s ?? list[0].id);
        return;
      }
      fetchTtsVoices()
        .then((r) => {
          if (!alive) return;
          setServerAvailable(r.available);
          setServer(r.voices);
          setSelected((s) => s ?? r.voices[0]?.name);
        })
        .catch((caught) => {
          logCaught('hooks/useTtsEngine.ts:serverVoices', caught);
          if (alive) setServerAvailable(false);
        });
    });
    return () => {
      alive = false;
    };
  }, [appLang]);

  const onDevice = (device?.length ?? 0) > 0;
  const choices: TtsChoice[] = onDevice
    ? device!.map((v) => ({ key: v.id, label: `${v.language} · ${v.name}` }))
    : server.map((v) => ({ key: v.name, label: `${v.name} · ${v.locale.slice(0, 2)}` }));

  return {
    /** null = még tölt; true = a telefon szól; false = a szerver (Pro) */
    onDevice: device === null ? null : onDevice,
    /** van-e egyáltalán hang (telefon vagy szerver) */
    available: onDevice ? true : serverAvailable,
    needsPro: !onDevice,
    choices,
    selected,
    setSelected,
    /** szöveg → hangfájl ({ uri, duration }) — a telefonon vagy a szerveren */
    generate: async (text: string): Promise<{ uri: string; duration: number }> => {
      if (onDevice) {
        const v = device!.find((x) => x.id === selected) ?? device![0];
        return speakToFile(text, v);
      }
      return generateTts(text, selected);
    },
  };
}
