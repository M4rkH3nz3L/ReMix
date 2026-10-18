import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { profileStyles as styles } from './styles';

/**
 * 💾 A szekció-kártyák közös „Mentés" gombja — mindegyik a TELJES profilt menti.
 * Mentés közben spinner, egyébként a gomb (invalid profilnál letiltva).
 */
export function SaveButton({
  saving,
  valid,
  onSave,
}: {
  saving: boolean;
  valid: boolean;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={{ marginTop: 12 }}>
      {saving ? (
        <View style={styles.busyBox}>
          <ActivityIndicator color={palette.text} />
        </View>
      ) : (
        <PrimaryButton icon="checkmark" label={t('common.save')} disabled={!valid} onPress={onSave} />
      )}
    </View>
  );
}
