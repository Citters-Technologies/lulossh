import { buildTree } from '../src/store/folders';
import type { Host } from '../src/store/models';
import { byName, colorFor, favorites, frequent } from '../src/store/ranking';

const h = (name: string, p: Partial<Host> = {}): Host => ({
  id: name,
  name,
  host: 'x',
  port: 22,
  username: 'u',
  auth: { type: 'password', password: 'p' },
  ...p,
});

test('orden alfabético natural y sin acentos', () => {
  const names = [h('web10'), h('Ávila'), h('web2'), h('base')]
    .sort(byName)
    .map(x => x.name);
  expect(names).toEqual(['Ávila', 'base', 'web2', 'web10']);
});

test('carpetas y hosts del árbol en orden alfabético', () => {
  const t = buildTree(
    [h('zeta', { group: 'B' }), h('alfa', { group: 'B' }), h('x', { group: 'a' })],
    byName,
  );
  expect(t.folders.map(f => f.name)).toEqual(['a', 'B']);
  expect(t.folders[1].hosts.map(x => x.name)).toEqual(['alfa', 'zeta']);
});

test('favoritos en orden alfabético', () => {
  expect(
    favorites([h('b', { favorite: true }), h('c'), h('a', { favorite: true })]).map(
      x => x.name,
    ),
  ).toEqual(['a', 'b']);
});

test('frecuentes: por uso, sin favoritos ni nunca usados, con límite', () => {
  const list = frequent(
    [
      h('poco', { useCount: 1 }),
      h('mucho', { useCount: 9 }),
      h('fav', { useCount: 50, favorite: true }),
      h('nunca'),
      h('reciente', { useCount: 1, lastUsedAt: 100 }),
    ],
    2,
  );
  expect(list.map(x => x.name)).toEqual(['mucho', 'reciente']);
});

test('color de avatar estable', () => {
  expect(colorFor('web')).toBe(colorFor('web'));
});
