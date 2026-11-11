/**
 * Grupos como carpetas anidadas. El grupo de un host es una ruta
 * "Clientes/Acme/Web"; se aceptan también rutas antiguas con " / ".
 */
import type { Host } from './models';
import { compareText } from './ranking';

export const splitPath = (group?: string): string[] =>
  (group ?? '')
    .split('/')
    .map(p => p.trim())
    .filter(Boolean);

/** Ruta normalizada ("A/B") o undefined si está vacía. */
export const normPath = (group?: string): string | undefined =>
  splitPath(group).join('/') || undefined;

export interface FolderNode {
  name: string;
  path: string;
  folders: FolderNode[];
  hosts: Host[];
  /** Hosts en esta carpeta y sus subcarpetas. */
  count: number;
}

/**
 * Orden manual: para cada carpeta (ruta en minúsculas, "" = raíz) la lista de
 * hijos en el orden elegido. Lo que no esté en la lista va detrás, en orden
 * alfabético. Las carpetas siempre van antes que los hosts.
 */
export type ManualOrder = Record<string, string[]>;
export const ORDER_PREF = 'hostOrder';
export const folderKey = (name: string) => 'f:' + name.toLowerCase();
export const hostKey = (id: string) => 'h:' + id;
const orderSlot = (path: string) => path.toLowerCase();

function applyOrder<T>(items: T[], keyOf: (t: T) => string, list?: string[]) {
  if (!list?.length) {
    return;
  }
  const idx = new Map(list.map((k, i) => [k, i]));
  const rank = (t: T) => idx.get(keyOf(t)) ?? Number.MAX_SAFE_INTEGER;
  // sort es estable: los no ordenados mantienen el orden alfabético previo.
  items.sort((a, b) => rank(a) - rank(b));
}

/** Sube (-1) o baja (+1) un hijo dentro de su carpeta. Devuelve el orden nuevo. */
export function moveInFolder(
  order: ManualOrder,
  node: FolderNode,
  key: string,
  dir: -1 | 1,
): ManualOrder {
  const folders = node.folders.map(f => folderKey(f.name));
  const hosts = node.hosts.map(h => hostKey(h.id));
  const list = key.startsWith('f:') ? folders : hosts;
  const i = list.indexOf(key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) {
    return order;
  }
  [list[i], list[j]] = [list[j], list[i]];
  return { ...order, [orderSlot(node.path)]: [...folders, ...hosts] };
}

/** Al renombrar/mover una carpeta, conserva su orden y el de sus hijos. */
export function renameInOrder(
  order: ManualOrder,
  from: string,
  to: string,
): ManualOrder {
  const src = orderSlot(splitPath(from).join('/'));
  const dst = orderSlot(splitPath(to).join('/'));
  if (src === dst || !src || !dst) {
    return order; // a la raíz: sus hijos vuelven a orden alfabético
  }
  const out: ManualOrder = {};
  for (const [slot, list] of Object.entries(order)) {
    const moved =
      slot === src ? dst : slot.startsWith(src + '/') ? dst + slot.slice(src.length) : slot;
    out[moved] = list;
  }
  // La clave de la carpeta en su carpeta madre cambia si cambia el nombre.
  const srcParts = src.split('/');
  const dstParts = dst.split('/');
  const parentSlot = srcParts.slice(0, -1).join('/');
  const sameParent = parentSlot === dstParts.slice(0, -1).join('/');
  const parentList = out[parentSlot];
  if (parentList) {
    const oldKey = 'f:' + srcParts[srcParts.length - 1];
    out[parentSlot] = sameParent
      ? parentList.map(k => (k === oldKey ? 'f:' + dstParts[dstParts.length - 1] : k))
      : parentList.filter(k => k !== oldKey);
  }
  return out;
}

export function buildTree(
  hosts: Host[],
  sortHosts: (a: Host, b: Host) => number = () => 0,
  order: ManualOrder = {},
): FolderNode {
  const root: FolderNode = {
    name: '',
    path: '',
    folders: [],
    hosts: [],
    count: 0,
  };
  for (const h of hosts) {
    let node = root;
    node.count++;
    const parts = splitPath(h.group);
    parts.forEach((part, i) => {
      let child = node.folders.find(
        f => f.name.toLowerCase() === part.toLowerCase(),
      );
      if (!child) {
        child = {
          name: part,
          path: parts.slice(0, i + 1).join('/'),
          folders: [],
          hosts: [],
          count: 0,
        };
        node.folders.push(child);
      }
      child.count++;
      node = child;
    });
    node.hosts.push(h);
  }
  const sortRec = (n: FolderNode) => {
    n.folders.sort((a, b) => compareText(a.name, b.name));
    n.hosts.sort(sortHosts);
    const list = order[orderSlot(n.path)];
    applyOrder(n.folders, f => folderKey(f.name), list);
    applyOrder(n.hosts, h => hostKey(h.id), list);
    n.folders.forEach(sortRec);
  };
  sortRec(root);
  return root;
}

/** Todas las carpetas existentes (incluidas las intermedias), ordenadas. */
export function allFolderPaths(hosts: Host[]): string[] {
  const set = new Set<string>();
  hosts.forEach(h => {
    const parts = splitPath(h.group);
    parts.forEach((_, i) => set.add(parts.slice(0, i + 1).join('/')));
  });
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Mover/renombrar una carpeta: cambia el prefijo de ruta de sus hosts. */
export function renameFolder(
  hosts: Host[],
  from: string,
  to: string,
): Host[] {
  const src = splitPath(from);
  const dst = splitPath(to);
  return hosts.map(h => {
    const parts = splitPath(h.group);
    const inside =
      parts.length >= src.length &&
      src.every((p, i) => p.toLowerCase() === parts[i].toLowerCase());
    if (!inside) {
      return h;
    }
    return { ...h, group: normPath([...dst, ...parts.slice(src.length)].join('/')) };
  });
}
