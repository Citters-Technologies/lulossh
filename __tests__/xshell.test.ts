import {
  groupFromPath,
  parseImport,
  parseIni,
  parseXsh,
} from '../src/import/xshell';

const XSH = [
  '﻿[SessionInfo]',
  'Version=7.0',
  '[CONNECTION]',
  'Host=10.0.0.5',
  'Port=2222',
  'Protocol=SSH',
  '[CONNECTION:AUTHENTICATION]',
  'UserName=deploy',
  'Method=1',
  'UserKey=id_ed25519_prod',
  'Password=dGhpcyBpcyBlbmNyeXB0ZWQ=',
].join('\r\n');

test('parseIni lee secciones y claves', () => {
  const ini = parseIni(XSH);
  expect(ini.CONNECTION.Host).toBe('10.0.0.5');
  expect(ini['CONNECTION:AUTHENTICATION'].UserName).toBe('deploy');
});

test('grupo a partir de las carpetas (tras Sessions/)', () => {
  expect(groupFromPath('Xshell/Sessions/Clientes/Web/prod.xsh')).toBe(
    'Clientes/Web',
  );
  expect(groupFromPath('Casa/nas.xsh')).toBe('Casa');
  expect(groupFromPath('nas.xsh')).toBeUndefined();
});

test('sesión SSH con clave', () => {
  expect(parseXsh('Sessions/Clientes/web-prod.xsh', XSH)).toEqual({
    name: 'web-prod',
    group: 'Clientes',
    host: '10.0.0.5',
    port: 2222,
    username: 'deploy',
    keyName: 'id_ed25519_prod',
  });
});

test('sesión con contraseña no lleva clave aunque tenga UserKey', () => {
  const h = parseXsh('a.xsh', XSH.replace('Method=1', 'Method=0'));
  expect(typeof h !== 'string' && h.keyName).toBeUndefined();
});

test('ignora protocolos que no son SSH', () => {
  expect(parseXsh('t.xsh', XSH.replace('Protocol=SSH', 'Protocol=TELNET'))).toMatch(
    /TELNET/,
  );
});

test('parseImport separa hosts, claves y descartes', () => {
  const r = parseImport([
    { path: 'Sessions/web.xsh', text: XSH },
    {
      path: 'id_ed25519_prod.pem',
      text: '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----\n',
    },
    { path: 'notas.txt', text: 'hola' },
  ]);
  expect(r.hosts).toHaveLength(1);
  expect(r.keys.map(k => k.name)).toEqual(['id_ed25519_prod']);
  expect(r.skipped).toEqual(['notas.txt: formato no reconocido']);
});
