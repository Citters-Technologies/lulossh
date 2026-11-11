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

export function buildTree(
  hosts: Host[],
  sortHosts: (a: Host, b: Host) => number = () => 0,
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
