import { useTranslation } from 'react-i18next';
import { Pressable, Text, TextInput, View } from 'react-native';

import { styles } from '@/components/editor/panels/text/textStyles';
import { Chip, PanelSection } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { TEXT_TEMPLATES } from '@/constants/textTemplates';
import { templatePatch } from '@/lib/textPanelOps';
import type { EditorState } from '@/store/editorStore';
import type { TextClip } from '@/types/project';

export type TextTab = 'style' | 'anim' | 'extra';

export interface TextContentSectionsProps {
  clip: TextClip;
  updateClip: EditorState['updateClip'];
  tab: TextTab;
  setTab: (tab: TextTab) => void;
}

/** a szöveg tartalma, a sablonok és a tab-sor (Stílus / Animáció / Extra) */
export function TextContentSections({ clip, updateClip, tab, setTab }: TextContentSectionsProps) {
  const { t: tr } = useTranslation();
  return (
    <>
      <PanelSection title={tr('panels.text.sectionText')}>
        <TextInput
          value={clip.text}
          onChangeText={(text) => updateClip(clip.id, { text })}
          multiline
          style={styles.input}
          placeholder={tr('panels.text.textPlaceholder')}
          placeholderTextColor={palette.textDim}
        />
      </PanelSection>

      <PanelSection title={tr('panels.text.sectionTemplates')}>
        <View style={styles.row}>
          {TEXT_TEMPLATES.map((t) => (
            <Chip key={t.id} label={tr(t.label)} active={false} onPress={() => updateClip(clip.id, templatePatch(t))} />
          ))}
        </View>
      </PanelSection>

      {/* tabos elrendezés a látványterv szerint (Stílus / Animáció / Extra) */}
      <View style={styles.tabRow}>
        {(['style', 'anim', 'extra'] as const).map((id) => (
          <Pressable
            key={id}
            onPress={() => setTab(id)}
            style={[styles.tabItem, tab === id ? styles.tabItemActive : null]}
          >
            <Text style={[styles.tabText, tab === id ? styles.tabTextActive : null]}>
              {tr('panels.text.tab_' + id)}
            </Text>
          </Pressable>
        ))}
      </View>
    </>
  );
}
