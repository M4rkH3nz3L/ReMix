import type { TFunction } from 'i18next';
import type { Dispatch, SetStateAction } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Chip, PrimaryButton } from '@/components/ui/controls';
import { styles } from '@/components/shop/shopStyles';
import { palette } from '@/constants/editor';
import { KIND_EMOJI } from '@/lib/shopScreenOps';
import type { ProjectMeta } from '@/types/project';

/** 🛍️ A publikálás modal (REFACTOR: a src/app/shop.tsx-ből) — sablon vagy hangcsomag, projekt, cím, ár. */
export function PublishSheet({
  t,
  publishOpen,
  setPublishOpen,
  pubKind,
  setPubKind,
  myProjects,
  pubProjectId,
  setPubProjectId,
  pubTitle,
  setPubTitle,
  pubPrice,
  setPubPrice,
  busy,
  doPublish,
}: {
  t: TFunction;
  publishOpen: boolean;
  setPublishOpen: Dispatch<SetStateAction<boolean>>;
  pubKind: 'template' | 'soundpack';
  setPubKind: Dispatch<SetStateAction<'template' | 'soundpack'>>;
  myProjects: ProjectMeta[];
  pubProjectId: string | null;
  setPubProjectId: Dispatch<SetStateAction<string | null>>;
  pubTitle: string;
  setPubTitle: Dispatch<SetStateAction<string>>;
  pubPrice: string;
  setPubPrice: Dispatch<SetStateAction<string>>;
  busy: boolean;
  doPublish: () => void;
}) {
  return (
    <Modal visible={publishOpen} transparent animationType="slide" onRequestClose={() => setPublishOpen(false)}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTap} onPress={() => setPublishOpen(false)} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>{t('shop.publishCta')}</Text>
          <Text style={styles.sheetHint}>{t('shop.publishHint')}</Text>
          <View style={styles.kindRow}>
            <Chip label={`${KIND_EMOJI.template} ${t('shop.kind.template')}`} active={pubKind === 'template'} onPress={() => setPubKind('template')} />
            <Chip label={`${KIND_EMOJI.soundpack} ${t('shop.kind.soundpack')}`} active={pubKind === 'soundpack'} onPress={() => setPubKind('soundpack')} />
          </View>
          {pubKind === 'soundpack' ? <Text style={styles.sheetHint}>{t('shop.soundPackHint')}</Text> : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.kindRow}>
            {myProjects.map((p) => (
              <Chip
                key={p.id}
                label={p.name}
                active={pubProjectId === p.id}
                onPress={() => {
                  setPubProjectId(p.id);
                  setPubTitle(p.name);
                }}
              />
            ))}
          </ScrollView>
          <Text style={styles.fieldLabel}>{t('shop.titleLabel')}</Text>
          <TextInput
            style={styles.input}
            value={pubTitle}
            onChangeText={setPubTitle}
            placeholder={t('shop.titleLabel')}
            placeholderTextColor={palette.textDim}
          />
          <Text style={styles.fieldLabel}>{t('shop.priceLabel')}</Text>
          <TextInput
            style={styles.input}
            value={pubPrice}
            onChangeText={setPubPrice}
            keyboardType="decimal-pad"
            placeholder="0,40"
            placeholderTextColor={palette.textDim}
          />
          <View style={{ marginTop: 12 }}>
            <PrimaryButton
              label={t('shop.publishNow')}
              icon="pricetag-outline"
              onPress={doPublish}
              disabled={busy || !pubProjectId || !pubTitle.trim()}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}
