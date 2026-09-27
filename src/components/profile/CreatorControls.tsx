import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Chip } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { CREATOR_TYPES, type CreatorType } from '@/lib/creatorProfile';

/** Egy creator-típus lokalizált címkéje (emoji + i18n név). */
export function creatorTypeLabel(t: (k: string) => string, type: CreatorType): string {
  return `${type.emoji} ${t(`creatorProfile.types.${type.id}`)}`;
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * 🎬 Creator-típus választó — több is bejelölhető (toggle chipek).
 */
export function CreatorTypePicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation();
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <View style={styles.wrap}>
      {CREATOR_TYPES.map((type) => (
        <Chip
          key={type.id}
          label={creatorTypeLabel(t, type)}
          active={value.includes(type.id)}
          onPress={() => toggle(type.id)}
        />
      ))}
    </View>
  );
}

/**
 * 🏷️ Tag-szerkesztő — szabad tagek felvétele (Enter/„+"), eltávolítható chipek,
 * és opcionális javaslat-chipek. Kis-nagybetűre érzéketlen dedup, max. `limit`.
 */
export function TagEditor({
  value,
  onChange,
  suggestions = [],
  placeholder,
  limit = 20,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
  limit?: number;
}) {
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const tag = raw.trim();
    if (!tag || value.length >= limit || value.some((x) => norm(x) === norm(tag))) {
      setDraft('');
      return;
    }
    onChange([...value, tag]);
    setDraft('');
  };
  const remove = (tag: string) => onChange(value.filter((x) => x !== tag));
  const freeSuggestions = suggestions.filter((s) => !value.some((x) => norm(x) === norm(s)));

  return (
    <View style={{ gap: 8 }}>
      {value.length > 0 ? (
        <View style={styles.wrap}>
          {value.map((tag) => (
            <Pressable key={tag} onPress={() => remove(tag)} style={styles.tagChip} hitSlop={6}>
              <Text style={styles.tagChipText}>{tag}</Text>
              <Ionicons name="close" size={13} color="#fff" />
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.inputRow}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={() => add(draft)}
          placeholder={placeholder}
          placeholderTextColor={palette.textDim}
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          blurOnSubmit={false}
        />
        <Pressable
          onPress={() => add(draft)}
          disabled={!draft.trim() || value.length >= limit}
          style={[styles.addBtn, (!draft.trim() || value.length >= limit) && styles.addBtnOff]}
        >
          <Ionicons name="add" size={20} color="#fff" />
        </Pressable>
      </View>

      {freeSuggestions.length > 0 && value.length < limit ? (
        <View style={styles.wrap}>
          {freeSuggestions.map((s) => (
            <Chip key={s} label={`+ ${s}`} active={false} onPress={() => add(s)} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * 🎬 Creator-típus jelvények (csak megjelenítés) — a csatorna-fejléchez.
 */
export function CreatorBadges({ types, max }: { types: string[]; max?: number }) {
  const { t } = useTranslation();
  const shown = max ? types.slice(0, max) : types;
  const list = shown
    .map((id) => CREATOR_TYPES.find((ct) => ct.id === id))
    .filter((x): x is CreatorType => !!x);
  if (list.length === 0) {
    return null;
  }
  return (
    <View style={[styles.wrap, { justifyContent: 'center' }]}>
      {list.map((type) => (
        <View key={type.id} style={styles.badge}>
          <Text style={styles.badgeText}>{creatorTypeLabel(t, type)}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * 🏷️ Tag-jelvények (csak megjelenítés) — készség/érdeklődés listákhoz.
 */
export function TagBadges({ tags, max }: { tags: string[]; max?: number }) {
  const shown = max ? tags.slice(0, max) : tags;
  if (shown.length === 0) {
    return null;
  }
  return (
    <View style={styles.wrap}>
      {shown.map((tag) => (
        <View key={tag} style={styles.tagBadge}>
          <Text style={styles.tagBadgeText}>{tag}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: palette.accent,
    borderRadius: 999,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 6,
  },
  tagChipText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    flex: 1,
    backgroundColor: palette.surfaceHigh,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnOff: { opacity: 0.4 },
  badge: {
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  badgeText: { color: palette.text, fontSize: 13, fontWeight: '700' },
  tagBadge: {
    backgroundColor: palette.accentSoft,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  tagBadgeText: { color: palette.text, fontSize: 12, fontWeight: '600' },
});
