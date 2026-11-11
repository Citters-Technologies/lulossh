import {
  buildTree,
  folderKey,
  hostKey,
  ManualOrder,
  moveInFolder,
  renameInOrder,
} from '../src/store/folders';
import type { Host } from '../src/store/models';
import { byName } from '../src/store/ranking';

const host = (id: string, name: string, group?: string): Host => ({
  id,
  name,
  host: '10.0.0.1',
  port: 22,
  username: 'root',
  auth: { type: 'password', password: 'x' },
  group,
});

const hosts = [
  host('a', 'alpha'),
  host('b', 'bravo'),
  host('c', 'charlie'),
  host('w', 'web1', 'Clientes/Acme'),
  host('x', 'web2', 'Clientes/Beta'),
];

const names = (o: ManualOrder) => {
  const t = buildTree(hosts, byName, o);
  return {
    root: t.hosts.map(h => h.name),
    folders: t.folders[0].folders.map(f => f.name),
  };
};

test('sin orden manual es alfabético', () => {
  expect(names({})).toEqual({
    root: ['alpha', 'bravo', 'charlie'],
    folders: ['Acme', 'Beta'],
  });
});

test('subir y bajar hosts y carpetas', () => {
  let o: ManualOrder = {};
  let t = buildTree(hosts, byName, o);
  o = moveInFolder(o, t, hostKey('c'), -1);
  expect(names(o).root).toEqual(['alpha', 'charlie', 'bravo']);
  t = buildTree(hosts, byName, o);
  o = moveInFolder(o, t, hostKey('c'), -1);
  expect(names(o).root).toEqual(['charlie', 'alpha', 'bravo']);
  // En el extremo no cambia nada.
  t = buildTree(hosts, byName, o);
  expect(moveInFolder(o, t, hostKey('c'), -1)).toBe(o);

  const clientes = t.folders[0];
  o = moveInFolder(o, clientes, folderKey('Beta'), -1);
  expect(names(o).folders).toEqual(['Beta', 'Acme']);
});

test('los hosts nuevos van al final, en orden alfabético', () => {
  const o: ManualOrder = { '': [hostKey('c'), hostKey('a')] };
  const t = buildTree([...hosts, host('d', 'delta'), host('0', 'aaa')], byName, o);
  expect(t.hosts.map(h => h.name)).toEqual([
    'charlie',
    'alpha',
    'aaa',
    'bravo',
    'delta',
  ]);
});

test('renombrar una carpeta conserva su orden', () => {
  const o: ManualOrder = {
    clientes: ['f:beta', 'f:acme'],
    'clientes/acme': ['h:w'],
  };
  expect(renameInOrder(o, 'Clientes/Acme', 'Clientes/ACME Corp')).toEqual({
    clientes: ['f:beta', 'f:acme corp'],
    'clientes/acme corp': ['h:w'],
  });
  expect(renameInOrder(o, 'Clientes', 'Empresas')).toEqual({
    empresas: ['f:beta', 'f:acme'],
    'empresas/acme': ['h:w'],
  });
});
