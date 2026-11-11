import { backupFileName, mergeById, parsePayload } from '../src/store/backup';

test('restaurar añade lo que falta y no pisa lo existente', () => {
  const { merged, added } = mergeById(
    [{ id: 'a', v: 'mío' }],
    [
      { id: 'a', v: 'copia' },
      { id: 'b', v: 'copia' },
    ],
  );
  expect(added).toBe(1);
  expect(merged).toEqual([
    { id: 'a', v: 'mío' },
    { id: 'b', v: 'copia' },
  ]);
});

test('rechaza ficheros que no son copias de LuloSSH', () => {
  expect(() => parsePayload('{"meta":{"app":"Otra"}}')).toThrow();
  const ok = parsePayload(
    JSON.stringify({
      exportedAt: 1,
      meta: { app: 'LuloSSH', hosts: [{ id: 'h' }] },
      secrets: { k: { pem: 'x' } },
    }),
  );
  expect(ok.meta.identities).toEqual([]);
  expect(ok.secrets.k.pem).toBe('x');
});

test('nombre de fichero con la fecha', () => {
  expect(backupFileName(new Date(2026, 10, 11))).toBe('lulossh-20261111.lulossh');
});
