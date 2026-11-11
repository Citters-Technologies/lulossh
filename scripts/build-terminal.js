/**
 * Genera src/terminal/terminalHtml.generated.ts: un HTML autocontenido con
 * xterm.js y su CSS embebidos, para usarlo en un WebView sin red.
 * Se ejecuta en postinstall (ver package.json).
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const xtermJs = read('node_modules/@xterm/xterm/lib/xterm.js').replace(
  /\/\/# sourceMappingURL=.*$/m,
  '',
);
const fitJs = read('node_modules/@xterm/addon-fit/lib/addon-fit.js').replace(
  /\/\/# sourceMappingURL=.*$/m,
  '',
);
const css = read('node_modules/@xterm/xterm/css/xterm.css');
const bridge = read('src/terminal/bridge.js');

// Evita cerrar el <script> prematuramente si el bundle contuviera "</script".
const safe = s => s.replace(/<\/script/gi, '<\\/script');

const html = `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>${css}
html,body{margin:0;padding:0;height:100%;background:#0b0f14;overflow:hidden}
#term{position:absolute;inset:0;padding:4px}
/* Con teclado nativo xterm nunca tiene foco, así que pinta el cursor "inactivo"
   (un recuadro de 1px casi invisible) y, si parpadea, lo deja apagado. Pintamos
   la clase base .xterm-cursor (siempre presente) como un bloque sólido verde de
   marca, sea cual sea su estilo, visible y sin parpadeo, para poder seguirlo al
   moverse por el prompt. */
:root{--lulo-cursor:#9be22d;--lulo-cursor-accent:#0b0f14}
.xterm .xterm-cursor,
.xterm .xterm-cursor.xterm-cursor-outline,
.xterm .xterm-cursor.xterm-cursor-bar,
.xterm .xterm-cursor.xterm-cursor-underline{
  background-color:var(--lulo-cursor) !important;color:var(--lulo-cursor-accent) !important;
  outline:none !important;box-shadow:none !important;
  opacity:1 !important;visibility:visible !important;
}
</style></head>
<body><div id="term"></div>
<script>${safe(xtermJs)}</script>
<script>${safe(fitJs)}</script>
<script>${safe(bridge)}</script>
</body></html>`;

const out = path.join(root, 'src/terminal/terminalHtml.generated.ts');
fs.writeFileSync(
  out,
  `// ARCHIVO GENERADO por scripts/build-terminal.js. No editar.\n` +
    `export const TERMINAL_HTML = ${JSON.stringify(html)};\n`,
);
console.log(`terminalHtml.generated.ts (${(html.length / 1024) | 0} KB)`);
