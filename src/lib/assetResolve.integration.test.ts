import { ensureClipAssets, flattenClipUris, resolveClipUri } from '@/lib/assetResolve';
import { applyCommand } from '@/lib/commands';
import { buildRenderPlan } from '@/lib/nativeRender';
import type { RenderSettings } from '@/lib/render';
import { findMissingMedia } from '@/lib/videdFile';
import type { Project, VideoClip } from '@/types/project';

/**
 * 🔗 ADR-012 arany-út: a `uri → assetId` lánc EGY tesztben, end-to-end.
 *
 *   nyers projekt → ensureClipAssets (backfill, linkel) → RELINK_ASSET a
 *   command-buson → a FOGYASZTÓK (resolveClipUri / buildRenderPlan /
 *   flattenClipUris / findMissingMedia) MIND az asset ÚJ uri-ját tükrözik,
 *   egyetlen klip-mezőt sem kézzel írva át.
 *
 * Ez bizonyítja, hogy az asset a forrás-igazság: egy relink → minden fogyasztó követi.
 */

const SETTINGS: RenderSettings = { resolution: 1080, fps: 30, quality: 'high', codec: 'h264' };

const vClip = (id: string, start: number, uri: string): VideoClip =>
  ({
    id,
    kind: 'video',
    start,
    duration: 5,
    uri,
    trimIn: 0,
    sourceDuration: 5,
    speed: 1,
    volume: 1,
    filterId: 'none',
  }) as VideoClip;

// két klip UGYANARRA a forrásra (uri) → egy assetre linkel majd
const rawProject = (): Project =>
  ({
    id: 'p',
    name: 'arany-út',
    aspectRatio: '9:16',
    fps: 30,
    tracks: [
      {
        id: 't1',
        type: 'video',
        name: 'v',
        clips: [vClip('c1', 0, 'file:///shared.mp4'), vClip('c2', 5, 'file:///shared.mp4')],
      },
    ],
    assets: [],
    schemaVersion: 6,
  }) as unknown as Project;

describe('ADR-012 arany-út — egy relink → minden fogyasztó követi', () => {
  it('backfill linkel → RELINK_ASSET a buszon → resolveClipUri/render-plan/flatten/missing MIND az új uri', () => {
    // 1) backfill: a két klip UGYANARRA az egy assetre linkel (uri-dedup, determinisztikus id)
    const linked = ensureClipAssets(rawProject());
    expect(linked.assets).toHaveLength(1);
    const assetId = linked.assets[0].id;
    const clips = () => linked.tracks[0].clips;
    expect((clips()[0] as unknown as { assetId: string }).assetId).toBe(assetId);
    expect((clips()[1] as unknown as { assetId: string }).assetId).toBe(assetId);

    // 2) RELINK_ASSET a COMMAND-BUSON (undo-zható): az asset új forrásra mutat
    const relinked = applyCommand(linked, {
      type: 'RELINK_ASSET',
      assetId,
      newUri: 'file:///moved.mp4',
    });
    expect(relinked).not.toBeNull();

    // 3) a fogyasztók MIND az új uri-t látják — EGYETLEN klip-mezőt sem írtunk kézzel
    const p = relinked!;
    // resolveClipUri (az asset a forrás-igazság) — mindkét klipre
    for (const clip of p.tracks[0].clips) {
      expect(resolveClipUri(p, clip)).toBe('file:///moved.mp4');
    }
    // on-device render-plan: mindkét szegmens az új forrásból
    const plan = buildRenderPlan(p, SETTINGS);
    expect(plan.video).toHaveLength(2);
    expect(plan.video.every((seg) => seg.uri === 'file:///moved.mp4')).toBe(true);
    // felhő-feltöltés előtti lapítás: a klip-uri-k is az új forrásra lapulnak
    const flat = flattenClipUris(p);
    expect(flat.tracks[0].clips.every((c) => (c as unknown as { uri: string }).uri === 'file:///moved.mp4')).toBe(true);
    // hiányzó-média (jest-ben nincs fájlrendszer → mind „hiányzó"): az ÚJ uri-t jelenti,
    // és egyszer (a két klip egy assetet/uri-t oszt) — a régi uri már nem szerepel
    const missing = findMissingMedia(p);
    expect(missing.map((m) => m.uri)).toEqual(['file:///moved.mp4']);
  });

  it('a relink NEM érinti a más assetre hivatkozó klipeket', () => {
    const base = ensureClipAssets({
      ...rawProject(),
      tracks: [
        {
          id: 't1',
          type: 'video',
          name: 'v',
          clips: [vClip('c1', 0, 'file:///a.mp4'), vClip('c2', 5, 'file:///b.mp4')],
        } as never,
      ],
    } as Project);
    expect(base.assets).toHaveLength(2);
    const astA = base.assets.find((a) => a.uri === 'file:///a.mp4')!.id;
    const relinked = applyCommand(base, { type: 'RELINK_ASSET', assetId: astA, newUri: 'file:///a2.mp4' })!;
    const uris = relinked.tracks[0].clips.map((c) => resolveClipUri(relinked, c));
    expect(uris).toEqual(['file:///a2.mp4', 'file:///b.mp4']); // csak az A-asset klipje mozdult
  });
});
