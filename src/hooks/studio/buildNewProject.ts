import type { TFunction } from 'i18next';

import { applyAudioTemplate, type AudioTemplate } from '@/lib/audioTemplates';
import { BG_SWATCHES, clampDim, isHexColor, nearestAspect } from '@/lib/canvasPresets';
import { makeId } from '@/lib/id';
import { docFromTemplate, IMAGE_TEMPLATES } from '@/lib/imageTemplates';
import { PODCAST_EPISODE, startRunning } from '@/lib/workflowTemplate';
import {
  createEmptyProject,
  parseHashtags,
  parseKeywords,
  type CreateProjectConfig,
} from '@/lib/projectUtils';
import { useBrandStyle } from '@/store/brandStyleStore';
import type { MeshFormat } from '@/types/model3d';
import type { AspectRatio, Asset, AudioMasterTarget, ProjectKind } from '@/types/project';

/** az „Új projekt” űrlap értékei (a useStudio állapotából) */
export interface NewProjectForm {
  name: string;
  seoDescription: string;
  seoHashtags: string;
  seoKeywords: string;
  aspect: AspectRatio;
  kind: ProjectKind;
  designTemplate: string;
  imgW: string;
  imgH: string;
  imgFormat: 'raster' | 'vector';
  bg: string;
  audioTarget: AudioMasterTarget;
  model3dFormat: MeshFormat;
  audioTemplate: AudioTemplate;
  sources: Asset[];
}

/**
 * 🏗️ Az „Új projekt” űrlapból az induló projekt (REFACTOR: a useStudio `create`-jéből, változatlan
 * sorrendben). `null` = nincs név (a gomb ilyenkor tiltott — védőkorlát).
 */
export function buildNewProject(
  {
    name,
    seoDescription,
    seoHashtags,
    seoKeywords,
    aspect,
    kind,
    designTemplate,
    imgW,
    imgH,
    imgFormat,
    bg,
    audioTarget,
    model3dFormat,
    audioTemplate,
    sources,
  }: NewProjectForm,
  t: TFunction
) {
  const title = name.trim();
  const description = seoDescription.trim();
  const hashtags = parseHashtags(seoHashtags);
  const keywords = parseKeywords(seoKeywords);
  // védőkorlát: a gomb név nélkül tiltott; a SEO itt elhagyható (S22: a megosztás kéri be)
  if (!title) {
    return null;
  }
  // 🎛️ fajta-specifikus induló-beállítások: kép → szabad W×H + formátum + háttér, hang → master-cél
  const config: CreateProjectConfig = {};
  // a projekt-szintű aspectRatio: képnél a megadott W×H-ból a legközelebbi enum
  let projectAspect = aspect;
  const tpl = kind === 'design' ? IMAGE_TEMPLATES.find((x) => x.key === designTemplate) ?? IMAGE_TEMPLATES[0] : null;
  if (tpl) {
    // 🎨 S8: a Design-projekt a választott sablon vásznán indul
    projectAspect = nearestAspect(tpl.width, tpl.height);
    config.image = { width: tpl.width, height: tpl.height, format: 'vector', background: tpl.background };
  } else if (kind === 'image') {
    const w = clampDim(imgW);
    const h = clampDim(imgH);
    projectAspect = nearestAspect(w, h);
    config.image = {
      width: w,
      height: h,
      format: imgFormat,
      // érvénytelen hex → essen vissza az alap sötétre (a 'transparent' átmegy)
      background: bg === 'transparent' || isHexColor(bg) ? bg : BG_SWATCHES[0],
    };
  } else if (kind === 'audio' || kind === 'music') {
    config.audioMasterTarget = audioTarget;
  } else if (kind === 'model3d') {
    config.model3dStorageFormat = model3dFormat;
  }
  // a cím szolgál a projekt neveként ÉS a SEO-címként is (később külön szerkeszthető)
  const created = createEmptyProject(
    title,
    projectAspect,
    { title, description, hashtags, keywords },
    kind,
    config
  );
  // 🎨 a „Design" belépési pont (S8): az első lap a sablon szerkeszthető rétegeivel, márkára színezve
  const designed = tpl ? { ...created, imageDocs: [docFromTemplate(tpl, title, () => makeId('lyr'), useBrandStyle.getState())] } : created;
  // 🎵 a „Zene" belépési pont (S10): ugyanaz a hang-projekt, a Zene-sablonnal (ha a felhasználó nem választott mást)
  const base =
    kind === 'audio' || kind === 'music'
      ? applyAudioTemplate(created, kind === 'music' && audioTemplate === 'blank' ? 'music' : audioTemplate, {
          voice: t('studio.audio.template.trackVoice'),
          music: t('studio.audio.template.trackMusic'),
          sfx: t('studio.audio.template.trackSfx'),
          sections: [t('studio.audio.template.intro'), t('studio.audio.template.verse'), t('studio.audio.template.chorus'), t('studio.audio.template.outro')],
        })
      : designed;
  // ▶️ C4: a Podcast-sablon a Podcast-epizód munkafolyamatot is elindítja (a Hang Stúdió sávja vezet végig)
  const withRun = (kind === 'audio' || kind === 'music') && audioTemplate === 'podcast' ? { ...base, workflowRun: startRunning(PODCAST_EPISODE, () => makeId('wf'), new Date().toISOString()) } : base;
  // 🗂️ a létrehozáskor hozzáadott források a projekt forrás-mappájába (assets)
  const project = sources.length > 0 ? { ...withRun, assets: sources } : withRun;
  return project;
}
