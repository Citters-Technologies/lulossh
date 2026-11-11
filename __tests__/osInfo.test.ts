import { osBadge, osCommand, parseOs } from '../src/remote/osInfo';

test('lee el ID de os-release entre ruido de la shell', () => {
  expect(parseOs('Welcome\nLULO_HAS:claude\nLULO_OS:ubuntu\n')).toBe('ubuntu');
  expect(parseOs('LULO_OS:"rocky"\r\n')).toBe('rocky');
  expect(parseOs('LULO_OS:Darwin')).toBe('darwin');
  expect(parseOs('LULO_OS:')).toBeUndefined();
  expect(parseOs('nada')).toBeUndefined();
});

test('distros conocidas con sigla y color; desconocidas, pingüino', () => {
  expect(osBadge('debian')?.label).toBe('DEB');
  expect(osBadge('raro')?.label).toBe('🐧');
  expect(osBadge(undefined)).toBeUndefined();
});

test('el sondeo no depende de bash', () => {
  expect(osCommand()).toContain('/etc/os-release');
  expect(osCommand()).toContain('uname -s');
});
