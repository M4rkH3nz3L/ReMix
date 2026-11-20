import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { shared } from '@/components/live/studio/liveStudioStyles';
import { palette } from '@/constants/editor';
import { rtmpSubmitDisabled } from '@/lib/liveStudioOps';

export interface AddRtmpModalProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  rtmpLabel: string;
  setRtmpLabel: (v: string) => void;
  rtmpUrl: string;
  setRtmpUrl: (v: string) => void;
  rtmpKey: string;
  setRtmpKey: (v: string) => void;
  onSubmit: () => void;
}

/** 🎥 Add RTMP target modal — a kulcs maszkolt mezőben, a mentés a workeren át */
export function AddRtmpModal({
  open,
  setOpen,
  rtmpLabel,
  setRtmpLabel,
  rtmpUrl,
  setRtmpUrl,
  rtmpKey,
  setRtmpKey,
  onSubmit,
}: AddRtmpModalProps) {
  const { t } = useTranslation();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
      <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)}>
        <Pressable style={styles.modalCard} onPress={() => {}}>
          <Text style={styles.modalTitle}>{t('live.studio.addRtmp', { defaultValue: 'Add RTMP target' })}</Text>
          <TextInput
            value={rtmpLabel}
            onChangeText={setRtmpLabel}
            placeholder={t('live.studio.rtmpLabel', { defaultValue: 'Label (e.g. YouTube)' })}
            placeholderTextColor={palette.textDim}
            style={styles.modalInput}
          />
          <TextInput
            value={rtmpUrl}
            onChangeText={setRtmpUrl}
            placeholder="rtmp://a.rtmp.youtube.com/live2"
            placeholderTextColor={palette.textDim}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.modalInput}
          />
          <TextInput
            value={rtmpKey}
            onChangeText={setRtmpKey}
            placeholder={t('live.studio.rtmpKey', { defaultValue: 'Stream key' })}
            placeholderTextColor={palette.textDim}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={styles.modalInput}
          />
          <Text style={styles.modalHint}>{t('live.studio.rtmpHint', { defaultValue: 'Stored encrypted & owner-only; never leaves the server. Needs Pro + LiveKit egress to stream.' })}</Text>
          <View style={styles.modalRow}>
            <Pressable style={[styles.modalBtn]} onPress={() => setOpen(false)}>
              <Text style={styles.modalBtnText}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable
              style={[styles.modalBtn, styles.modalBtnPrimary, rtmpSubmitDisabled(rtmpUrl, rtmpKey) && shared.startBtnDisabled]}
              disabled={rtmpSubmitDisabled(rtmpUrl, rtmpKey)}
              onPress={onSubmit}
            >
              <Text style={[styles.modalBtnText, styles.modalBtnTextPrimary]}>{t('common.add', { defaultValue: 'Add' })}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: { flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: palette.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 18,
    gap: 10,
    borderTopWidth: 1,
    borderColor: palette.border,
  },
  modalTitle: { color: palette.text, fontSize: 17, fontWeight: '800', marginBottom: 2 },
  modalInput: {
    backgroundColor: palette.surface,
    borderRadius: 10,
    color: palette.text,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  modalHint: { color: palette.textDim, fontSize: 11, lineHeight: 16 },
  modalRow: { flexDirection: 'row', gap: 10, marginTop: 6 },
  modalBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: palette.surface,
  },
  modalBtnPrimary: { backgroundColor: palette.accent },
  modalBtnText: { color: palette.text, fontSize: 15, fontWeight: '700' },
  modalBtnTextPrimary: { color: '#fff', fontWeight: '800' },
});
