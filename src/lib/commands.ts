import { t as tr } from 'i18next';

import { relinkAsset } from '@/lib/assetResolve';
import { canHostClip, findClip, relinkUri, replaceClip, splitClip } from '@/lib/projectUtils';
import type { LiveDoc } from '@/types/live';
import type {
  AspectRatio,
  Asset,
  AudioMaster,
  Chapter,
  Clip,
  ImageDoc,
  Marker,
  ParticlesConfig,
  Project,
  TimelineRegion,
  TrackType,
} from '@/types/project';

/**
 * Command-réteg (full-plan F0): minden szerkesztő-művelet nevesített command,
 * amit egy pure reducer alkalmaz. A user és később az AI ugyanezen a felületen
 * dolgozik — az AI kimenete validálva, undo-zhatóan fut le (anti-cél: AI sosem
 * írja közvetlenül a state-et).
 */

export type EditorCommand =
  | { type: 'ADD_CLIP'; trackType: TrackType; clip: Clip; asset?: Asset }
  | { type: 'ADD_CLIPS'; trackType: TrackType; clips: Clip[] }
  | { type: 'UPDATE_CLIP'; clipId: string; patch: Partial<Clip> }
  | { type: 'REMOVE_CLIP'; clipId: string }
  /** klip másik (kompatibilis) sávra mozgatása + új kezdet (frame-illesztett a hívónál) */
  | { type: 'MOVE_CLIP'; clipId: string; toTrackType: TrackType; start: number }
  | { type: 'SPLIT_CLIP'; clipId: string; time: number }
  | { type: 'SET_ASPECT'; aspectRatio: AspectRatio }
  | { type: 'SET_FPS'; fps: number }
  | { type: 'RENAME_PROJECT'; name: string }
  | { type: 'ADD_ASSET'; asset: Asset }
  | { type: 'UPDATE_ASSET'; assetId: string; patch: Partial<Asset> }
  | { type: 'REMOVE_ASSET'; assetId: string }
  /** teljes sáv-újraépítés egy undo-lépésben (pl. AI cut-lista alkalmazása) */
  | { type: 'REPLACE_TRACK_CLIPS'; trackType: TrackType; clips: Clip[] }
  /**
   * TÖBB sáv újraépítése egy undo-lépésben — olyan műveletekhez, amik az egész
   * idővonalat mozgatják (pl. intro beszúrása: minden sáv csúszik).
   */
  | {
      type: 'REPLACE_TRACKS';
      tracks: { trackType: TrackType; clips: Clip[] }[];
      assets?: Asset[];
      label?: string;
    }
  | { type: 'RELINK_URI'; oldUri: string; newUri: string }
  | { type: 'RELINK_ASSET'; assetId: string; newUri: string }
  /** ✨ projekt-szintű részecske-réteg be/ki (null = kikapcsol) */
  | { type: 'SET_PARTICLES'; particles: ParticlesConfig | null }
  /** 🔖 a marker-lista cseréje (hozzáadás/törlés/átnevezés egy lépésben) */
  | { type: 'SET_MARKERS'; markers: Marker[] }
  | { type: 'SET_CHAPTERS'; chapters: Chapter[] }
  | { type: 'SET_AUDIO_MASTER'; audioMaster: AudioMaster | null }
  | { type: 'SET_TRACK_GAIN'; trackType: TrackType; gain: number }
  | { type: 'SET_REGIONS'; regions: TimelineRegion[] }
  | { type: 'SET_LINKS'; links: string[][] }
  /**
   * 🎨 Kép-dokumentum beírása (létrehozás ÉS módosítás). A réteg-műveletek
   * pure függvények (imageDoc.ts), az eredményt EZ a parancs teszi be — így a
   * réteg-szerkesztés is undo-zható, ugyanúgy, mint bármi más.
   */
  | { type: 'UPSERT_IMAGE_DOC'; doc: ImageDoc; label?: string }
  | { type: 'REMOVE_IMAGE_DOC'; docId: string }
  /**
   * 🎥 Live-produkció dokumentum beírása (létrehozás ÉS módosítás). A jelenet-/
   * forrás-/cél-műveletek pure függvények (`liveDoc.ts`), az eredményt EZ a
   * parancs teszi a `project.live`-ba — így a live-szerkesztés is undo-zható
   * (mint `UPSERT_IMAGE_DOC`), és élőben a data-channelre broadcastolható.
   */
  | { type: 'SET_LIVE_DOC'; doc: LiveDoc; label?: string };

export type EventActor = 'user' | 'ai' | 'system' | 'remote';

/** A projekt-történet egy bejegyzése — az AI-memória (F3) nyersanyaga. */
export interface ProjectEvent {
  id: string;
  /** ISO időbélyeg */
  at: string;
  actor: EventActor;
  command: EditorCommand;
  /**
   * A command nehéz mezői (klip-tömbök, kép-rétegek) csonkolva vannak — lásd
   * `lib/eventLog.ts`. Ilyen commandot TILOS `applyCommand`-dal alkalmazni; a
   * napló csak `describeCommand()`-hoz való.
   */
  slim?: true;
}

/**
 * A command alkalmazása — pure függvény. `null`, ha a command érvénytelen vagy
 * nem változtat semmin (ilyenkor history/event sem íródik).
 */
export function applyCommand(project: Project, cmd: EditorCommand): Project | null {
  switch (cmd.type) {
    case 'ADD_CLIP': {
      let base = project;
      let clip = cmd.clip;
      if (cmd.asset) {
        // azonos uri → a meglévő assetre mutatunk, nem duplikálunk
        const existing = project.assets.find((a) => a.uri === cmd.asset!.uri);
        if (existing) {
          clip = { ...clip, assetId: existing.id } as Clip;
        } else {
          base = { ...project, assets: [...project.assets, cmd.asset] };
          clip = { ...clip, assetId: cmd.asset.id } as Clip;
        }
      }
      return addClips(base, cmd.trackType, [clip]);
    }

    case 'ADD_CLIPS':
      if (cmd.clips.length === 0) {
        return null;
      }
      return addClips(project, cmd.trackType, cmd.clips);

    case 'UPDATE_CLIP': {
      const found = findClip(project, cmd.clipId);
      if (!found) {
        return null;
      }
      return replaceClip(project, { ...found.clip, ...cmd.patch } as Clip);
    }

    case 'REMOVE_CLIP': {
      if (!findClip(project, cmd.clipId)) {
        return null;
      }
      return {
        ...project,
        tracks: project.tracks.map((track) => ({
          ...track,
          clips: track.clips.filter((c) => c.id !== cmd.clipId),
        })),
      };
    }

    case 'MOVE_CLIP': {
      const found = findClip(project, cmd.clipId);
      if (!found) {
        return null;
      }
      // inkompatibilis cél-sáv VAGY nem létező sáv → no-op
      if (!canHostClip(cmd.toTrackType, found.clip.kind) ||
        !project.tracks.some((t) => t.type === cmd.toTrackType)) {
        return null;
      }
      // no-op: ugyanazon a sávon, ugyanarra a kezdetre
      if (found.track.type === cmd.toTrackType && found.clip.start === cmd.start) {
        return null;
      }
      const moved = { ...found.clip, start: cmd.start } as Clip;
      return {
        ...project,
        tracks: project.tracks.map((track) => {
          // a cél-sáv: kivesszük (ha ugyanaz) + betesszük az új kezdettel
          if (track.type === cmd.toTrackType) {
            return { ...track, clips: [...track.clips.filter((c) => c.id !== cmd.clipId), moved] };
          }
          // a forrás-sáv (más, mint a cél): kivesszük
          if (track.id === found.track.id) {
            return { ...track, clips: track.clips.filter((c) => c.id !== cmd.clipId) };
          }
          return track;
        }),
      };
    }

    case 'SPLIT_CLIP': {
      const found = findClip(project, cmd.clipId);
      if (!found) {
        return null;
      }
      const parts = splitClip(found.clip, cmd.time);
      if (!parts) {
        return null;
      }
      return {
        ...project,
        tracks: project.tracks.map((track) =>
          track.id === found.track.id
            ? {
                ...track,
                clips: track.clips.flatMap((c) => (c.id === cmd.clipId ? parts : [c])),
              }
            : track
        ),
      };
    }

    case 'SET_ASPECT':
      if (project.aspectRatio === cmd.aspectRatio) {
        return null;
      }
      return { ...project, aspectRatio: cmd.aspectRatio };

    case 'SET_FPS': {
      const fps = Math.round(cmd.fps);
      if (!(fps > 0) || (project.fps ?? 30) === fps) {
        return null;
      }
      return { ...project, fps };
    }

    case 'RENAME_PROJECT': {
      const name = cmd.name.trim();
      if (!name || name === project.name) {
        return null;
      }
      return { ...project, name };
    }

    case 'SET_PARTICLES': {
      const next = cmd.particles ?? undefined;
      if (JSON.stringify(next) === JSON.stringify(project.particles)) {
        return null;
      }
      return { ...project, particles: next };
    }

    case 'ADD_ASSET':
      // azonos uri-jú asset nem duplikálódik
      if (project.assets.some((a) => a.id === cmd.asset.id || a.uri === cmd.asset.uri)) {
        return null;
      }
      return { ...project, assets: [...project.assets, cmd.asset] };

    case 'UPDATE_ASSET': {
      // csak az Organize-metaadatokat engedjük (rating/favorite/tags/name)
      const allowed: (keyof Asset)[] = ['favorite', 'rating', 'tags', 'name'];
      const patch = Object.fromEntries(
        Object.entries(cmd.patch).filter(([k]) => allowed.includes(k as keyof Asset))
      );
      if (Object.keys(patch).length === 0 || !project.assets.some((a) => a.id === cmd.assetId)) {
        return null;
      }
      return {
        ...project,
        assets: project.assets.map((a) => (a.id === cmd.assetId ? { ...a, ...patch } : a)),
      };
    }

    case 'REMOVE_ASSET':
      // a forrás-mappából elvett asset (a hívó csak a NEM használtat kínálja törlésre)
      if (!project.assets.some((a) => a.id === cmd.assetId)) {
        return null;
      }
      return { ...project, assets: project.assets.filter((a) => a.id !== cmd.assetId) };

    case 'REPLACE_TRACK_CLIPS':
      if (!project.tracks.some((t) => t.type === cmd.trackType)) {
        return null;
      }
      return {
        ...project,
        tracks: project.tracks.map((track) =>
          track.type === cmd.trackType ? { ...track, clips: cmd.clips } : track
        ),
      };

    case 'UPSERT_IMAGE_DOC': {
      const docs = project.imageDocs ?? [];
      const index = docs.findIndex((d) => d.id === cmd.doc.id);
      if (index >= 0 && JSON.stringify(docs[index]) === JSON.stringify(cmd.doc)) {
        return null; // semmi nem változott — ne szemetelje a history-t
      }
      const next = index >= 0
        ? docs.map((d) => (d.id === cmd.doc.id ? cmd.doc : d))
        : [...docs, cmd.doc];
      return { ...project, imageDocs: next };
    }

    case 'REMOVE_IMAGE_DOC': {
      const docs = project.imageDocs ?? [];
      const next = docs.filter((d) => d.id !== cmd.docId);
      if (next.length === docs.length) {
        return null;
      }
      return { ...project, imageDocs: next.length > 0 ? next : undefined };
    }

    case 'SET_LIVE_DOC': {
      if (JSON.stringify(project.live ?? null) === JSON.stringify(cmd.doc)) {
        return null; // semmi nem változott — ne szemetelje a history-t
      }
      return { ...project, live: cmd.doc };
    }

    case 'SET_MARKERS': {
      const next = [...cmd.markers].sort((a, b) => a.time - b.time);
      const prev = project.markers ?? [];
      if (JSON.stringify(prev) === JSON.stringify(next)) {
        return null;
      }
      return { ...project, markers: next.length > 0 ? next : undefined };
    }

    case 'SET_CHAPTERS': {
      const next = [...cmd.chapters].sort((a, b) => a.start - b.start);
      const prev = project.chapters ?? [];
      if (JSON.stringify(prev) === JSON.stringify(next)) {
        return null;
      }
      return { ...project, chapters: next.length > 0 ? next : undefined };
    }

    case 'SET_REGIONS': {
      const next = [...cmd.regions].sort((a, b) => a.start - b.start);
      const prev = project.regions ?? [];
      if (JSON.stringify(prev) === JSON.stringify(next)) {
        return null;
      }
      return { ...project, regions: next.length > 0 ? next : undefined };
    }

    case 'SET_AUDIO_MASTER': {
      const next = cmd.audioMaster;
      if (JSON.stringify(project.audioMaster ?? null) === JSON.stringify(next ?? null)) {
        return null;
      }
      return { ...project, audioMaster: next ?? undefined };
    }

    case 'SET_TRACK_GAIN': {
      const g = Math.max(0, Math.min(1, cmd.gain));
      const prev = project.trackMix ?? {};
      if ((prev[cmd.trackType]?.gain ?? 1) === g) {
        return null;
      }
      return { ...project, trackMix: { ...prev, [cmd.trackType]: { gain: g } } };
    }

    case 'SET_LINKS': {
      // csak a 2+ elemű csoportok érdekesek; rendezve az összehasonlításhoz
      const next = cmd.links.filter((g) => g.length > 1).map((g) => [...g].sort());
      const prev = project.links ?? [];
      if (JSON.stringify(prev) === JSON.stringify(next)) {
        return null;
      }
      return { ...project, links: next.length > 0 ? next : undefined };
    }

    case 'REPLACE_TRACKS': {
      const byType = new Map(cmd.tracks.map((t) => [t.trackType, t.clips]));
      if (byType.size === 0) {
        return null;
      }
      const newAssets = (cmd.assets ?? []).filter(
        (a) => !project.assets.some((existing) => existing.id === a.id)
      );
      return {
        ...project,
        assets: [...project.assets, ...newAssets],
        tracks: project.tracks.map((track) =>
          byType.has(track.type)
            ? { ...track, clips: byType.get(track.type)! }
            : track
        ),
      };
    }

    case 'RELINK_URI': {
      if (cmd.oldUri === cmd.newUri) {
        return null;
      }
      const touches =
        project.assets.some((a) => a.uri === cmd.oldUri) ||
        project.tracks.some((t) =>
          t.clips.some(
            (c) =>
              ('uri' in c && c.uri === cmd.oldUri) ||
              (c.kind === 'shape' && c.imageUri === cmd.oldUri)
          )
        );
      if (!touches) {
        return null;
      }
      return relinkUri(project, cmd.oldUri, cmd.newUri);
    }

    case 'RELINK_ASSET': {
      // asset-centrikus relink (ADR-012): egy asset uri-cseréje → minden rá
      // hivatkozó klip követi. Nincs változás (ismeretlen asset / azonos uri) → null.
      const next = relinkAsset(project, cmd.assetId, cmd.newUri);
      return next === project ? null : next;
    }
  }
}

function addClips(project: Project, trackType: TrackType, clips: Clip[]): Project | null {
  if (!project.tracks.some((t) => t.type === trackType)) {
    return null;
  }
  return {
    ...project,
    tracks: project.tracks.map((track) =>
      track.type === trackType ? { ...track, clips: [...track.clips, ...clips] } : track
    ),
  };
}

/** Rövid, ember-olvasható összefoglaló az event loghoz / AI-kontextushoz. */
export function describeCommand(cmd: EditorCommand): string {
  switch (cmd.type) {
    case 'ADD_CLIP':
      return tr('lib.commands.addClip', { kind: cmd.clip.kind, trackType: cmd.trackType });
    case 'ADD_CLIPS':
      return tr('lib.commands.addClips', { count: cmd.clips.length, trackType: cmd.trackType });
    case 'UPDATE_CLIP':
      return tr('lib.commands.updateClip', { keys: Object.keys(cmd.patch).join(', ') });
    case 'REMOVE_CLIP':
      return tr('lib.commands.removeClip');
    case 'MOVE_CLIP':
      return tr('lib.commands.moveClip', { trackType: cmd.toTrackType, defaultValue: `Move clip → ${cmd.toTrackType}` });
    case 'SPLIT_CLIP':
      return tr('lib.commands.splitClip', { time: cmd.time.toFixed(2) });
    case 'SET_ASPECT':
      return tr('lib.commands.setAspect', { aspectRatio: cmd.aspectRatio });
    case 'SET_FPS':
      return tr('lib.commands.setFps', { fps: cmd.fps });
    case 'RENAME_PROJECT':
      return tr('lib.commands.renameProject', { name: cmd.name });
    case 'SET_PARTICLES':
      return cmd.particles
        ? tr('lib.commands.setParticles', {
            preset: cmd.particles.preset,
            beatSync: cmd.particles.beatSync ? tr('lib.commands.beatSyncSuffix') : '',
          })
        : tr('lib.commands.particlesOff');
    case 'RELINK_ASSET':
      return tr('lib.commands.relinkAsset', { defaultValue: 'Relink asset' });
    case 'ADD_ASSET':
      return tr('lib.commands.addAsset', { name: cmd.asset.name ?? cmd.asset.kind });
    case 'UPDATE_ASSET':
      return tr('lib.commands.updateAsset', { keys: Object.keys(cmd.patch).join(', ') });
    case 'REMOVE_ASSET':
      return tr('lib.commands.removeAsset');
    case 'REPLACE_TRACK_CLIPS':
      return tr('lib.commands.replaceTrackClips', {
        trackType: cmd.trackType,
        count: cmd.clips.length,
      });
    case 'SET_MARKERS':
      return tr('lib.commands.setMarkers', { count: cmd.markers.length });
    case 'SET_CHAPTERS':
      return tr('lib.commands.setChapters', { count: cmd.chapters.length });
    case 'SET_AUDIO_MASTER':
      return tr('lib.commands.setAudioMaster', {
        target: cmd.audioMaster?.target ?? 'off',
        defaultValue: `Master: ${cmd.audioMaster?.target ?? 'off'}`,
      });
    case 'SET_TRACK_GAIN':
      return tr('lib.commands.setTrackGain', {
        track: cmd.trackType,
        defaultValue: `Track gain: ${cmd.trackType}`,
      });
    case 'SET_REGIONS':
      return tr('lib.commands.setRegions', { count: cmd.regions.length });
    case 'SET_LINKS':
      return tr('lib.commands.setLinks', { count: cmd.links.filter((g) => g.length > 1).length });
    case 'UPSERT_IMAGE_DOC':
      return (
        cmd.label ??
        tr('lib.commands.upsertImageDoc', {
          name: cmd.doc.name,
          count: cmd.doc.layers.length,
        })
      );
    case 'REMOVE_IMAGE_DOC':
      return tr('lib.commands.removeImageDoc');
    case 'SET_LIVE_DOC':
      return (
        cmd.label ??
        tr('lib.commands.setLiveDoc', {
          scenes: cmd.doc.scenes.length,
          defaultValue: `Live: ${cmd.doc.scenes.length} scene(s)`,
        })
      );
    case 'REPLACE_TRACKS':
      return cmd.label ?? tr('lib.commands.replaceTracks', { count: cmd.tracks.length });
    case 'RELINK_URI':
      return tr('lib.commands.relinkUri', {
        file: cmd.newUri.split('/').pop() ?? cmd.newUri,
      });
  }
}
