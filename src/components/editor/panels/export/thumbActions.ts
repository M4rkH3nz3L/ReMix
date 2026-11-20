import { router } from 'expo-router';
import type { TFunction } from 'i18next';
import { Alert } from 'react-native';

import type { ThumbStudioState } from '@/components/editor/panels/export/useThumbStudioState';
import { aspectValue } from '@/constants/editor';
import { makeId } from '@/lib/id';
import { logCaught } from '@/lib/logCaught';
import { thumbnailDoc, thumbnailDocOf } from '@/lib/thumbnailDoc';
import { discardThumbFrames, fetchThumbHeadlines, type ThumbFrame } from '@/lib/thumbStudio';
import { getTimelineTranscript } from '@/lib/transcripts';
import { useEditorStore } from '@/store/editorStore';
import type { Project } from '@/types/project';

/** a Thumbnail Studio műveletei (AI-címek, kocka választása) — a panel renderenként hozza létre */
export function createThumbActions(project: Project, t: TFunction, thumb: ThumbStudioState) {
  const { thumbs, setThumbs, setHeadlines, headlineStatus, setHeadlineStatus, selectedHeadline, setSelectedHeadline } =
    thumb;

  // 🎬 AI-címjavaslatok: projektnév + átirat-részlet a témához
  const loadHeadlines = async () => {
    if (headlineStatus) {
      return;
    }
    setHeadlineStatus(t('panels.export.writingHeadlines'));
    try {
      const transcript = await getTimelineTranscript(project).catch((caught) => { logCaught('components/editor/panels/ExportPanel.tsx:loadHeadlines', caught); return null; });
      const lines = (transcript ?? []).slice(0, 12).map((l) => l.text);
      const summary = `${project.name}\n${lines.join('\n')}`.slice(0, 800);
      const list = await fetchThumbHeadlines(summary);
      if (!list) {
        Alert.alert(t('panels.export.aiHeadlinesTitle'), t('panels.export.headlinesUnavailable'));
        return;
      }
      setHeadlines(list);
      setSelectedHeadline(list[0]);
    } finally {
      setHeadlineStatus(null);
    }
  };

  // 🖼️ CORE K5: a választott kockából a projekt SZERKESZTHETŐ thumbnail-lapja lesz (kocka + cím),
  // egy visszavonás-lépésben, és a Kép Stúdió nyílik rajta — ugyanazon a projekten
  const pickThumb = (frame: ThumbFrame) => {
    const st = useEditorStore.getState();
    if (!st.project) {
      return;
    }
    const existing = thumbnailDocOf(st.project);
    const doc = thumbnailDoc({
      id: existing?.id ?? makeId('doc'),
      name: t('panels.export.thumbDocName'),
      frameUri: frame.uri,
      headline: selectedHeadline,
      aspect: aspectValue(st.project.aspectRatio),
      aspectRatio: st.project.aspectRatio,
      layerId: makeId,
    });
    st.applyBatch(
      [
        { type: 'UPSERT_IMAGE_DOC', doc, label: t('lib.commands.setThumbnail') },
        { type: 'SET_THUMBNAIL_DOC', docId: doc.id },
      ],
      'user'
    );
    if (thumbs) discardThumbFrames(thumbs, frame.uri);
    setThumbs(null);
    router.push(`/studio/image/${st.project.id}?doc=${doc.id}`);
  };

  return { loadHeadlines, pickThumb };
}
