import {
  ALL_PROJECT_KINDS,
  PROJECT_KINDS,
  creatableKinds,
  isEditableKind,
  projectKindMeta,
} from '@/lib/projectKinds';
import { studioRoute } from '@/lib/projectUtils';

describe('projectKinds — CreativeDocument katalógus', () => {
  it('minden fajtának teljes metaadata van', () => {
    for (const k of ALL_PROJECT_KINDS) {
      const m = PROJECT_KINDS[k];
      expect(m.id).toBe(k);
      expect(m.emoji).toBeTruthy();
      expect(m.icon).toBeTruthy();
      expect(m.label).toContain('studio.kind.');
      expect(typeof m.route('x')).toBe('string');
    }
  });

  it('a kész stúdiók editable-ök, a CreativeDocument-bővítés nem', () => {
    expect(isEditableKind('video')).toBe(true);
    expect(isEditableKind('image')).toBe(true);
    expect(isEditableKind('audio')).toBe(true);
    expect(isEditableKind('writing')).toBe(false);
    expect(isEditableKind('code')).toBe(false);
    expect(isEditableKind('music')).toBe(false);
    expect(isEditableKind('design')).toBe(false);
  });

  it('a hiányzó/ismeretlen kind = videó (editable)', () => {
    expect(isEditableKind(undefined)).toBe(true);
    expect(projectKindMeta(undefined).id).toBe('video');
  });

  it('creatableKinds CSAK a kész stúdiókat adja (video/image/audio, sorrendben)', () => {
    expect(creatableKinds().map((m) => m.id)).toEqual(['video', 'image', 'audio']);
  });

  it('az editable fajták a saját stúdió-útvonalukra mutatnak', () => {
    expect(projectKindMeta('video').route('p1')).toBe('/editor/p1');
    expect(projectKindMeta('image').route('p1')).toBe('/studio/image/p1');
    expect(projectKindMeta('audio').route('p1')).toBe('/studio/audio/p1');
  });

  it('studioRoute a kész stúdiókra routol, a stúdió-nélkülit a videó-editorra ejti', () => {
    expect(studioRoute('image', 'p1')).toBe('/studio/image/p1');
    expect(studioRoute('audio', 'p1')).toBe('/studio/audio/p1');
    expect(studioRoute(undefined, 'p1')).toBe('/editor/p1');
    // CreativeDocument-bővítés (stúdió TBD) → biztonságos videó-editor fallback
    expect(studioRoute('writing', 'p1')).toBe('/editor/p1');
    expect(studioRoute('music', 'p1')).toBe('/editor/p1');
  });
});
