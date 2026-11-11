import { hostLabel, validateHost } from '../src/store/models';

const base = {
  name: 'web',
  host: 'example.com',
  port: 22,
  username: 'root',
  auth: { type: 'password' as const, password: 'x' },
};

test('host válido', () => {
  expect(validateHost(base)).toBeNull();
});

test('rechaza host vacío o con espacios', () => {
  expect(validateHost({ ...base, host: ' ' })).toMatch(/host/i);
  expect(validateHost({ ...base, host: 'a b' })).toMatch(/espacios/);
});

test('rechaza puertos fuera de rango', () => {
  expect(validateHost({ ...base, port: 0 })).toMatch(/Puerto/);
  expect(validateHost({ ...base, port: 70000 })).toMatch(/Puerto/);
  expect(validateHost({ ...base, port: NaN })).toMatch(/Puerto/);
});

test('exige clave si la auth es por clave', () => {
  expect(
    validateHost({ ...base, auth: { type: 'privateKey', keyId: '' } }),
  ).toMatch(/clave/);
});

test('hostLabel oculta el puerto 22', () => {
  expect(hostLabel(base)).toBe('root@example.com');
  expect(hostLabel({ ...base, port: 2222 })).toBe('root@example.com:2222');
});
