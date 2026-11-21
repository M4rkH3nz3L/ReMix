import * as storage from '@/lib/storage';
import {
  eventsKey,
  INDEX_KEY,
  lastAutoKey,
  MEDIA_REF_PREFIXES,
  projectKey,
  recoveryKey,
  TOMBSTONE_KEY,
  versionsKey,
} from '@/lib/projectStoreCore/keys';
import { folderOf, metaOf } from '@/lib/projectStoreCore/meta';
import { estimateProjectBytes, isProjectTooLarge, PROJECT_SIZE_WARN_BYTES } from '@/lib/projectStoreCore/limits';
import { recoveryIsFresher } from '@/lib/projectStoreCore/snapshots';
import type { Project } from '@/types/project';

/** 🧱 A helyi projekt-tár expo-mentes magja (REFACTOR: a src/lib/storage.ts-ből kiemelve) — a mai viselkedés rögzítve. */

const project = (over: Partial<Project> = {}): Project =>
  ({
    id: 'p1',
    name: 'Első',
    aspectRatio: '9:16',
    tracks: [
      { id: 't1', type: 'video', name: 'v', clips: [{ id: 'c1', kind: 'video', start: 1, duration: 4 }] },
      { id: 't2', type: 'text', name: 't', clips: [{ id: 'c2', kind: 'text', start: 0, duration: 2 }] },
    ],
    assets: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    schemaVersion: 10,
    ...over,
  }) as unknown as Project;

describe('a tárolási kulcsok — a lemezen lévő formátum, nem változhat', () => {
  it('pontos kulcs-stringek', () => {
    expect(INDEX_KEY).toBe('vided.projects.v1');
    expect(projectKey('x')).toBe('vided.project.v1.x');
    expect(eventsKey('x')).toBe('vided.events.v1.x');
    expect(versionsKey('x')).toBe('vided.versions.v1.x');
    expect(lastAutoKey('x')).toBe('vided.versions.lastauto.v1.x');
    expect(recoveryKey('x')).toBe('vided.recovery.v1.x');
    expect(TOMBSTONE_KEY).toBe('vided.deletedProjects.v1');
  });

  it('a média-GC hivatkozás-előtagjai: projekt, verziók, recovery, napló (a lastauto NEM)', () => {
    expect(MEDIA_REF_PREFIXES).toEqual(['vided.project.v1.', 'vided.versions.v1.', 'vided.recovery.v1.', 'vided.events.v1.']);
  });
});

describe('metaOf / folderOf', () => {
  it('a lista-bejegyzés mezői és sorrendje; a mappa/szinkron csak ha van', () => {
    expect(JSON.stringify(metaOf(project()))).toBe(
      '{"id":"p1","name":"Első","kind":"video","aspectRatio":"9:16","duration":5,"clipCount":2,"updatedAt":"2026-01-02T00:00:00.000Z"}',
    );
    expect(metaOf(project({ folder: 'Projektek/E', syncToRemix: true, kind: 'audio' }))).toMatchObject({
      kind: 'audio',
      folder: 'Projektek/E',
      syncToRemix: true,
    });
  });

  it('folderOf: csak nem üres string mappa; sérült/üres JSON → null', () => {
    expect(folderOf(JSON.stringify({ folder: 'Projektek/A' }))).toBe('Projektek/A');
    expect(folderOf(JSON.stringify({ folder: '' }))).toBeNull();
    expect(folderOf(JSON.stringify({ folder: 3 }))).toBeNull();
    expect(folderOf(null)).toBeNull();
    expect(folderOf('{')).toBeNull();
  });
});

describe('recovery-frissesség és méret-limit', () => {
  it('recoveryIsFresher: mentés nélkül mindig; egyébként szigorúan későbbi string', () => {
    expect(recoveryIsFresher('a', undefined)).toBe(true);
    expect(recoveryIsFresher('2026-01-02', '2026-01-01')).toBe(true);
    expect(recoveryIsFresher('2026-01-01', '2026-01-01')).toBe(false);
  });

  it('a méret a JSON-hossz; körkörös projekt → 0; a határ szigorú', () => {
    expect(PROJECT_SIZE_WARN_BYTES).toBe(2097152);
    const p = project();
    expect(estimateProjectBytes(p)).toBe(JSON.stringify(p).length);
    const circ = project() as Project & { self?: unknown };
    circ.self = circ;
    expect(estimateProjectBytes(circ)).toBe(0);
    const edge = project() as Project & { pad?: string };
    edge.pad = '';
    edge.pad = 'x'.repeat(PROJECT_SIZE_WARN_BYTES - JSON.stringify(edge).length);
    expect(isProjectTooLarge(edge)).toBe(false);
    edge.pad += 'x';
    expect(isProjectTooLarge(edge)).toBe(true);
  });
});

describe('a storage.ts barrel — a régi publikus felület', () => {
  it('minden korábbi futásidejű export elérhető, a belső segédek nem', () => {
    expect(Object.keys(storage).sort()).toEqual([
      'PROJECT_SIZE_WARN_BYTES', 'clearRecovery', 'deleteProject', 'deletedProjectIds', 'duplicateProject',
      'estimateProjectBytes', 'isProjectTooLarge', 'listProjects', 'loadEvents', 'loadProject', 'loadVersions',
      'markProjectsDeleted', 'readRecovery', 'recordAutoVersion', 'recoveryIsFresher', 'saveEvents', 'saveProject',
      'saveProjectAndEvents', 'saveVersions', 'writeRecovery',
    ]);
  });
});
