import { planImport, hostsWaitingForKey } from '../src/import/merge';
import {
  allFolderPaths,
  buildTree,
  normPath,
  renameFolder,
} from '../src/store/folders';
import type { Host, SshKey } from '../src/store/models';

const host = (p: Partial<Host>): Host => ({
  id: p.id ?? Math.random().toString(36),
  name: 'h',
  host: '10.0.0.1',
  port: 22,
  username: 'root',
  auth: { type: 'password', password: 'x' },
  ...p,
});

const key = (id: string, name: string): SshKey => ({
  id,
  name,
  type: 'ssh-ed25519',
  publicKey: '',
  createdAt: 0,
});

test('normPath acepta rutas antiguas con " / "', () => {
  expect(normPath(' Clientes / Web ')).toBe('Clientes/Web');
  expect(normPath('  ')).toBeUndefined();
});

test('árbol anidado con contadores', () => {
  const t = buildTree([
    host({ group: 'Clientes/Acme' }),
    host({ group: 'Clientes/Acme' }),
    host({ group: 'Clientes' }),
    host({}),
  ]);
  expect(t.hosts).toHaveLength(1);
  const clientes = t.folders[0];
  expect(clientes.name).toBe('Clientes');
  expect(clientes.count).toBe(3);
  expect(clientes.folders[0].path).toBe('Clientes/Acme');
  expect(clientes.folders[0].count).toBe(2);
});

test('carpetas intermedias y renombrado con subcarpetas', () => {
  const hs = [host({ id: 'a', group: 'A/B/C' }), host({ id: 'b', group: 'AB' })];
  expect(allFolderPaths(hs)).toEqual(['A', 'A/B', 'A/B/C', 'AB']);
  const moved = renameFolder(hs, 'A/B', 'X');
  expect(moved.find(h => h.id === 'a')?.group).toBe('X/C');
  expect(moved.find(h => h.id === 'b')?.group).toBe('AB'); // no es prefijo de carpeta
});

test('reimportar completa hosts huérfanos con la clave que ahora sí llega', () => {
  const orphan = host({
    id: 'o',
    name: 'web',
    auth: { type: 'password', password: '' },
  });
  const ok = host({ id: 'k', name: 'db', host: '10.0.0.2' });
  const plan = planImport(
    [orphan, ok],
    [key('K1', 'id_prod')],
    [
      { name: 'web', host: '10.0.0.1', port: 22, username: 'root', keyName: 'id_prod', group: 'Prod' },
      { name: 'db', host: '10.0.0.2', port: 22, username: 'root' },
      { name: 'new', host: '10.0.0.3', port: 22, username: 'root' },
    ],
    () => 'new-id',
  );
  expect(plan.toAdd.map(h => h.name)).toEqual(['new']);
  expect(plan.duplicates).toBe(1);
  expect(plan.toUpdate).toHaveLength(1);
  expect(plan.toUpdate[0].patch.auth).toEqual({ type: 'privateKey', keyId: 'K1' });
  expect(plan.toUpdate[0].changes).toEqual(['clave id_prod', 'carpeta Prod']);
});

test('la contraseña descifrada entra en hosts nuevos y completa huérfanos', () => {
  const orphan = host({
    id: 'o',
    name: 'web',
    auth: { type: 'password', password: '' },
  });
  const plan = planImport(
    [orphan],
    [],
    [
      // Host existente incompleto: se completa con la contraseña.
      { name: 'web', host: '10.0.0.1', port: 22, username: 'root', password: 's3cr3t' },
      // Host nuevo con contraseña descifrada.
      { name: 'new', host: '10.0.0.9', port: 22, username: 'root', password: 'pw9' },
    ],
    () => 'new-id',
  );
  expect(plan.toAdd[0].auth).toEqual({ type: 'password', password: 'pw9' });
  expect(plan.toUpdate[0].patch.auth).toEqual({
    type: 'password',
    password: 's3cr3t',
  });
  expect(plan.toUpdate[0].changes).toEqual(['contraseña']);
});

test('no toca hosts completos aunque cambie la clave en el origen', () => {
  const plan = planImport(
    [host({ id: 'a' })],
    [key('K1', 'id_prod')],
    [{ name: 'h', host: '10.0.0.1', port: 22, username: 'root', keyName: 'id_prod' }],
    () => 'x',
  );
  expect(plan.toUpdate.every(u => u.changes.length === 0)).toBe(true);
});

test('hosts que esperan una clave por nombre', () => {
  const hs = [
    host({ id: 'w', importedKeyName: 'ID_Prod', auth: { type: 'password', password: '' } }),
    host({ id: 'x', importedKeyName: 'id_prod' }), // completo: no espera
  ];
  expect(hostsWaitingForKey(hs, [], 'id_prod').map(h => h.id)).toEqual(['w']);
});
