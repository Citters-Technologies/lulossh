/**
 * CLIs de IA que se detectan en la máquina remota. Si están instalados, la
 * terminal muestra un botón translúcido que lanza `command` (reanudar chat).
 */
export interface AiTool {
  id: string;
  name: string;
  /** Ejecutable a buscar en el PATH remoto. */
  bin: string;
  /** Lo que se escribe en la shell al pulsar el botón. */
  command: string;
  glyph: string;
  color: string;
}

export const AI_TOOLS: AiTool[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    bin: 'claude',
    command: 'claude -r',
    glyph: '✻',
    color: '#d97757',
  },
  {
    id: 'devin',
    name: 'Devin',
    bin: 'devin',
    command: 'devin -r',
    glyph: '◆',
    color: '#4fb3ff',
  },
];

const MARK = 'LULO_HAS:';

/**
 * Comando de sondeo. Se prueba con un PATH ampliado (instalaciones típicas en
 * ~/.local/bin, npm global…) y con la shell de login del usuario, que carga
 * su PATH real (.bashrc/.zshrc). Sin salida si no hay nada.
 */
export function detectCommand(tools: AiTool[] = AI_TOOLS): string {
  const bins = tools.map(t => t.bin).join(' ');
  const loop = `for c in ${bins}; do command -v "$c" >/dev/null 2>&1 && echo ${MARK}$c; done`;
  const extraPath =
    '$HOME/.local/bin:$HOME/.claude/local:$HOME/.npm-global/bin:$HOME/.bun/bin:$HOME/bin:/usr/local/bin:/opt/homebrew/bin';
  return [
    `sh -c 'PATH="${extraPath}:$PATH"; ${loop}' 2>/dev/null`,
    `\${SHELL:-sh} -lic '${loop}' </dev/null 2>/dev/null`,
    'true',
  ].join('; ');
}

/** Herramientas presentes según la salida del sondeo. */
export function parseDetect(
  output: string,
  tools: AiTool[] = AI_TOOLS,
): AiTool[] {
  const found = new Set(
    output
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l.startsWith(MARK))
      .map(l => l.slice(MARK.length)),
  );
  return tools.filter(t => found.has(t.bin));
}
