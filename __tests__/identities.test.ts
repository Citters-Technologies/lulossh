import { isIncomplete, planImport } from '../src/import/merge';
import { Host, Identity, resolveHost } from '../src/store/models';

const orphan: Host = {
  id: 'h1',
  name: 'web',
  host: '10.0.0.1',
  port: 22,
  username: '',
  auth: { type: 'password', password: '' },
};
const root: Identity = {
  id: 'i1',
  name: 'root prod',
  username: 'root',
  auth: { type: 'privateKey', keyId: 'k1' },
};
const keys = [{ id: 'k1' }];

test('la identidad aporta usuario y credenciales', () => {
  const r = resolveHost({ ...orphan, identityId: 'i1' }, [root]);
  expect(r.username).toBe('root');
  expect(r.auth).toEqual({ type: 'privateKey', keyId: 'k1' });
});

test('un host huérfano deja de estar incompleto al asignarle identidad', () => {
  expect(isIncomplete(orphan, keys, [root])).toBe(true);
  expect(isIncomplete({ ...orphan, identityId: 'i1' }, keys, [root])).toBe(false);
});

test('identidad borrada o con clave borrada => incompleto', () => {
  expect(isIncomplete({ ...orphan, identityId: 'nope' }, keys, [root])).toBe(true);
  expect(isIncomplete({ ...orphan, identityId: 'i1' }, [], [root])).toBe(true);
});

test('reimportar no toca hosts que ya funcionan por su identidad', () => {
  const plan = planImport(
    [{ ...orphan, identityId: 'i1' }],
    [
      { id: 'k1', name: 'prod', type: 'ssh-ed25519', publicKey: '', createdAt: 0 },
      { id: 'k2', name: 'otra', type: 'ssh-ed25519', publicKey: '', createdAt: 0 },
    ],
    [{ name: 'web', host: '10.0.0.1', port: 22, username: '', keyName: 'otra' }],
    () => 'n',
    [root],
  );
  // No hay "clave otra" que aplicar: el host ya está completo vía identidad.
  expect(plan.toUpdate.every(u => !u.patch.auth)).toBe(true);
});
