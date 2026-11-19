/**
 * Motor de fusión de la sincronización (sin red ni cifrado: lógica pura).
 *
 * Cada elemento (host, identidad, clave) lleva `updatedAt`. Al fusionar dos
 * copias gana, elemento a elemento, la modificación más reciente ("última
 * escritura gana"). Los borrados se recuerdan como lápidas (id + fecha) para
 * que un dispositivo que no se ha enterado no los resucite.
 */

export interface Stamped {
  id: string;
  /** Última modificación (ms). Sin ella cuenta como muy antigua. */
  updatedAt?: number;
}

export type SyncKind = 'host' | 'identity' | 'key';

export interface Tombstone {
  kind: SyncKind;
  id: string;
  deletedAt: number;
}

/** Las lápidas se guardan este tiempo; después ya no hacen falta. */
export const TOMBSTONE_TTL_MS = 180 * 24 * 3600 * 1000;

const stampOf = (x: Stamped | undefined) => x?.updatedAt ?? 0;

/**
 * Campos que cambian con el uso (al conectar) y no cuentan como edición: si
 * no, conectar desde un dispositivo pisaría una edición hecha en otro.
 */
const VOLATILE = new Set(['updatedAt', 'lastUsedAt', 'useCount']);

/** Igualdad del contenido ignorando la marca de tiempo y el uso. */
function sameContent(a: unknown, b: unknown): boolean {
  const strip = (x: any) => {
    if (!x || typeof x !== 'object') {
      return x;
    }
    return Object.fromEntries(
      Object.entries(x).filter(([k]) => !VOLATILE.has(k)),
    );
  };
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

/**
 * Marca con `now` los elementos nuevos o cambiados respecto a `prev` y
 * devuelve las lápidas de los que han desaparecido.
 */
export function stampChanges<T extends Stamped>(
  kind: SyncKind,
  prev: T[],
  next: T[],
  now: number,
): { items: T[]; deleted: Tombstone[] } {
  const before = new Map(prev.map(x => [x.id, x]));
  const items = next.map(x => {
    const old = before.get(x.id);
    return old && sameContent(old, x)
      ? { ...x, updatedAt: old.updatedAt ?? x.updatedAt }
      : { ...x, updatedAt: now };
  });
  const still = new Set(next.map(x => x.id));
  const deleted = prev
    .filter(x => !still.has(x.id))
    .map(x => ({ kind, id: x.id, deletedAt: now }));
  return { items, deleted };
}

/** Une lápidas (la más reciente por elemento) y descarta las caducadas. */
export function mergeTombstones(
  a: Tombstone[],
  b: Tombstone[],
  now: number,
): Tombstone[] {
  const byKey = new Map<string, Tombstone>();
  for (const t of [...a, ...b]) {
    if (now - t.deletedAt > TOMBSTONE_TTL_MS) {
      continue;
    }
    const k = `${t.kind}:${t.id}`;
    const cur = byKey.get(k);
    if (!cur || t.deletedAt > cur.deletedAt) {
      byKey.set(k, t);
    }
  }
  return [...byKey.values()];
}

/**
 * Fusiona una colección: gana la versión más reciente de cada elemento y
 * desaparecen los borrados después de su última modificación. Conserva el
 * orden local y añade al final lo que solo existe en remoto.
 */
export function mergeItems<T extends Stamped>(
  kind: SyncKind,
  local: T[],
  remote: T[],
  tombstones: Tombstone[],
): T[] {
  const gone = new Map(
    tombstones.filter(t => t.kind === kind).map(t => [t.id, t.deletedAt]),
  );
  const remoteById = new Map(remote.map(x => [x.id, x]));
  const alive = (x: T) => {
    const d = gone.get(x.id);
    return d === undefined || stampOf(x) > d;
  };
  const out: T[] = [];
  const seen = new Set<string>();
  for (const l of local) {
    const r = remoteById.get(l.id);
    const pick = r && stampOf(r) > stampOf(l) ? r : l;
    seen.add(l.id);
    if (alive(pick)) {
      out.push(pick);
    }
  }
  for (const r of remote) {
    if (!seen.has(r.id) && alive(r)) {
      out.push(r);
    }
  }
  return out;
}

/** Resumen de lo que trae una fusión respecto al estado local. */
export function diffSummary<T extends Stamped>(
  before: T[],
  after: T[],
): { added: number; changed: number; removed: number } {
  const b = new Map(before.map(x => [x.id, x]));
  const a = new Map(after.map(x => [x.id, x]));
  let added = 0;
  let changed = 0;
  let removed = 0;
  for (const [id, x] of a) {
    const old = b.get(id);
    if (!old) {
      added++;
    } else if (!sameContent(old, x)) {
      changed++;
    }
  }
  for (const id of b.keys()) {
    if (!a.has(id)) {
      removed++;
    }
  }
  return { added, changed, removed };
}
