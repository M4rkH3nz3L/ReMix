import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { isValidOtp, maskPhone, sanitizeOtpInput } from '@/lib/phoneAuth';

import { authStyles as styles } from './authStyles';

/**
 * A belépés közbenső lépéseinek lapjai (REFACTOR: a src/app/auth.tsx-ből): MFA-kód,
 * SMS-kód és a „nézd meg a postaládád" — mindegyik a saját függőleges görgetőjében.
 */

/** 🔐 MFA — a jelszó utáni TOTP-kód (kétlépcsős belépés) */
export function MfaChallengeCard({
  mfaCode,
  setMfaCode,
  busy,
  error,
  submitMfa,
  backFromMfa,
}: {
  mfaCode: string;
  setMfaCode: (v: string) => void;
  busy: boolean;
  error: string | null;
  submitMfa: () => Promise<void>;
  backFromMfa: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.card}>
        <Ionicons name="shield-checkmark-outline" size={40} color={palette.accent} />
        <Text style={styles.title}>{t('auth.mfaTitle')}</Text>
        <Text style={styles.subtitle}>{t('auth.mfaBody')}</Text>
        <Text style={styles.fieldLabel}>{t('auth.mfaLabel')}</Text>
        <TextInput
          value={mfaCode}
          onChangeText={(v) => setMfaCode(sanitizeOtpInput(v))}
          placeholder="123456"
          placeholderTextColor={palette.textDim}
          style={[styles.input, styles.otpInput]}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          maxLength={6}
          editable={!busy}
          autoFocus
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <PrimaryButton
          label={t('auth.mfaVerifyAction')}
          onPress={submitMfa}
          disabled={busy || !isValidOtp(mfaCode)}
        />
        <Pressable
          onPress={backFromMfa}
          style={styles.switchRow}
          disabled={busy}
        >
          <Text style={styles.switchAction}>{t('auth.backToSignIn')}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

/** 📲 SMS-kód lap — a telefonos regisztráció második lépése */
export function SmsOtpCard({
  otpPhone,
  otpCode,
  setOtpCode,
  busy,
  error,
  submitOtp,
  resendOtp,
  changeOtpNumber,
}: {
  otpPhone: string;
  otpCode: string;
  setOtpCode: (v: string) => void;
  busy: boolean;
  error: string | null;
  submitOtp: () => Promise<void>;
  resendOtp: () => Promise<void>;
  changeOtpNumber: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.card}>
        <Ionicons name="chatbox-ellipses-outline" size={40} color={palette.accent} />
        <Text style={styles.title}>{t('auth.smsCodeTitle')}</Text>
        <Text style={styles.subtitle}>
          {t('auth.smsCodeBody', { phone: maskPhone(otpPhone) })}
        </Text>

        <Text style={styles.fieldLabel}>{t('auth.smsCodeLabel')}</Text>
        <TextInput
          value={otpCode}
          onChangeText={(v) => setOtpCode(sanitizeOtpInput(v))}
          placeholder="123456"
          placeholderTextColor={palette.textDim}
          style={[styles.input, styles.otpInput]}
          keyboardType="number-pad"
          autoComplete="sms-otp"
          textContentType="oneTimeCode"
          maxLength={6}
          editable={!busy}
          autoFocus
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <PrimaryButton
          label={t('auth.smsVerifyAction')}
          onPress={submitOtp}
          disabled={busy || !isValidOtp(otpCode)}
        />

        <Pressable onPress={resendOtp} style={styles.switchRow} disabled={busy}>
          <Text style={styles.switchAction}>{t('auth.smsResendAction')}</Text>
        </Pressable>
        <Pressable
          onPress={changeOtpNumber}
          style={styles.switchRow}
          disabled={busy}
        >
          <Text style={styles.switchAction}>{t('auth.smsChangeNumber')}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

/** ✉️ „nézd meg a postaládád" — a regisztráció e-mail-megerősítésre vár */
export function CheckEmailCard({
  email,
  notice,
  error,
  busy,
  resendEmail,
  switchMode,
}: {
  email: string;
  notice: string | null;
  error: string | null;
  busy: boolean;
  resendEmail: () => Promise<void>;
  switchMode: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.card}>
        <Ionicons name="mail-unread-outline" size={40} color={palette.accent} />
        <Text style={styles.title}>{t('auth.checkEmailTitle')}</Text>
        <Text style={styles.subtitle}>{t('auth.checkEmailBody', { email: email.trim() })}</Text>
        {notice ? <Text style={styles.hint}>{notice}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable onPress={resendEmail} style={styles.switchRow} disabled={busy}>
          <Text style={styles.switchAction}>{t('auth.resendEmail')}</Text>
        </Pressable>
        <Pressable onPress={switchMode} style={styles.switchRow}>
          <Text style={styles.switchAction}>{t('auth.backToSignIn')}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
