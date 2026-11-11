import { AI_TOOLS, detectCommand, parseDetect } from '../src/ai/tools';

test('detecta las herramientas marcadas, sin duplicados', () => {
  const out = 'Welcome!\nLULO_HAS:claude\nLULO_HAS:claude\r\nmotd ruido\n';
  expect(parseDetect(out).map(t => t.id)).toEqual(['claude']);
});

test('salida vacía o ruido no detecta nada', () => {
  expect(parseDetect('')).toEqual([]);
  expect(parseDetect('bash: no job control in this shell\n')).toEqual([]);
});

test('el sondeo busca todos los binarios y nunca falla', () => {
  const cmd = detectCommand();
  AI_TOOLS.forEach(t => expect(cmd).toContain(t.bin));
  expect(cmd.trim().endsWith('true')).toBe(true);
});

test('los botones reanudan el chat con -r', () => {
  AI_TOOLS.forEach(t => expect(t.command).toMatch(/ -r$/));
});
