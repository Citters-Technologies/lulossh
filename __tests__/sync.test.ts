import {
  buildSyncDoc,
  LocalState,
  mergeSync,
  parseSyncDoc,
  SyncDoc,
} from '../src/sync/document';
import {
  diffSummary,
  mergeItems,
  mergeTombstones,
  stampChanges,
  TOMBSTONE_TTL_MS,
} from '../src/sync/merge';

type Item = { id: string; name: string; updatedAt?: number; useCount?: number };

describe('stampChanges', () => {
  it('marca lo nuevo y lo editado, no lo que no cambia', () => {
    const prev: Item[] = [
      { id: 'a', name: 'A', updatedAt: 1 },
      { id: 'b', name: 'B', updatedAt: 1 },
    ];
    const next: Item[] = [
      { id: 'a', name: 'A', updatedAt: 1 },
      { id: 'b', name: 'B2', updatedAt: 1 },
      { id: 'c', name: 'C' },
    ];
    const { items, deleted } = stampChanges('host', prev, next, 100);
    expect(items.map(x => x.updatedAt)).toEqual([1, 100, 100]);
    expect(deleted).toEqual([]);
  });

  it('el uso (conectar) no cuenta como edición', () => {
    const prev: Item[] = [{ id: 'a', name: 'A', updatedAt: 1, useCount: 1 }];
    const next: Item[] = [{ id: 'a', name: 'A', updatedAt: 1, useCount: 2 }];
    expect(stampChanges('host', prev, next, 100).items[0].updatedAt).toBe(1);
  });

  it('lo que desaparece deja lápida', () => {
    const prev: Item[] = [{ id: 'a', name: 'A', updatedAt: 1 }];
    const { deleted } = stampChanges('host', prev, [], 50);
    expect(deleted).toEqual([{ kind: 'host', id: 'a', deletedAt: 50 }]);
  });
});

describe('mergeItems', () => {
  it('gana la edición más reciente de cada elemento', () => {
    const local: Item[] = [
      { id: 'a', name: 'A-local', updatedAt: 10 },
      { id: 'b', name: 'B-local', updatedAt: 30 },
    ];
    const remote: Item[] = [
      { id: 'a', name: 'A-remoto', updatedAt: 20 },
      { id: 'b', name: 'B-remoto', updatedAt: 5 },
      { id: 'c', name: 'C-remoto', updatedAt: 1 },
    ];
    const out = mergeItems('host', local, remote, []);
    expect(out.map(x => x.name)).toEqual(['A-remoto', 'B-local', 'C-remoto']);
  });

  it('un borrado gana a versiones anteriores y pierde ante ediciones posteriores', () => {
    const local: Item[] = [{ id: 'a', name: 'A', updatedAt: 10 }];
    const remote: Item[] = [{ id: 'b', name: 'B', updatedAt: 40 }];
    const tomb = [
      { kind: 'host' as const, id: 'a', deletedAt: 20 },
      { kind: 'host' as const, id: 'b', deletedAt: 30 },
    ];
    // a se borró después de su última edición; b se editó después del borrado.
    expect(mergeItems('host', local, remote, tomb).map(x => x.id)).toEqual([
      'b',
    ]);
  });

  it('las lápidas de otro tipo no afectan', () => {
    const local: Item[] = [{ id: 'a', name: 'A', updatedAt: 1 }];
    const tomb = [{ kind: 'key' as const, id: 'a', deletedAt: 99 }];
    expect(mergeItems('host', local, [], tomb)).toHaveLength(1);
  });
});

describe('mergeTombstones', () => {
  it('se queda con la más reciente y olvida las caducadas', () => {
    const now = TOMBSTONE_TTL_MS + 1000;
    const out = mergeTombstones(
      [
        { kind: 'host', id: 'a', deletedAt: now - 10 },
        { kind: 'host', id: 'old', deletedAt: 1 },
      ],
      [{ kind: 'host', id: 'a', deletedAt: now - 5 }],
      now,
    );
    expect(out).toEqual([{ kind: 'host', id: 'a', deletedAt: now - 5 }]);
  });
});

describe('documento de sincronización', () => {
  const host = (id: string, name: string, updatedAt: number) => ({
    id,
    name,
    host: `${id}.example.com`,
    port: 22,
    username: 'root',
    auth: { type: 'password' as const, password: 'x' },
    updatedAt,
  });
  const key = (id: string) => ({
    id,
    name: id,
    type: 'ssh-ed25519',
    publicKey: 'ssh-ed25519 AAAA',
    createdAt: 1,
    updatedAt: 1,
  });

  it('dos dispositivos convergen al mismo estado', () => {
    const base: LocalState = {
      hosts: [host('a', 'A', 1)],
      identities: [],
      keys: [],
      tombstones: [],
    };
    // Móvil edita A; tablet añade B. Cada uno sube tras fusionar.
    const movil: LocalState = { ...base, hosts: [host('a', 'A-editado', 5)] };
    const tablet: LocalState = {
      ...base,
      hosts: [host('a', 'A', 1), host('b', 'B', 6)],
    };
    const m1 = mergeSync(movil, null, 10);
    const docMovil = buildSyncDoc(m1, {}, 'movil', 10);
    const t1 = mergeSync(tablet, docMovil, 11);
    const docTablet = buildSyncDoc(t1, {}, 'tablet', 11);
    const m2 = mergeSync(m1, docTablet, 12);
    expect(t1.hosts.map(h => h.name)).toEqual(['A-editado', 'B']);
    expect(m2.hosts.map(h => h.name)).toEqual(['A-editado', 'B']);
  });

  it('solo sube los secretos de claves que existen', () => {
    const state: LocalState = {
      hosts: [],
      identities: [],
      keys: [key('k1')],
      tombstones: [],
    };
    const doc = buildSyncDoc(
      state,
      { k1: { pem: 'P1' }, borrada: { pem: 'P2' } },
      'movil',
      1,
    );
    expect(Object.keys(doc.secrets)).toEqual(['k1']);
  });

  it('rechaza ficheros ajenos y versiones futuras', () => {
    expect(() => parseSyncDoc('{"format":"otra-cosa"}')).toThrow();
    const futuro: Partial<SyncDoc> = {
      format: 'lulossh-sync',
      version: 99 as any,
    };
    expect(() => parseSyncDoc(JSON.stringify(futuro))).toThrow(/más nueva/);
  });

  it('resume lo que cambia', () => {
    expect(
      diffSummary(
        [host('a', 'A', 1), host('b', 'B', 1)],
        [host('a', 'A2', 2), host('c', 'C', 2)],
      ),
    ).toEqual({ added: 1, changed: 1, removed: 1 });
  });
});
