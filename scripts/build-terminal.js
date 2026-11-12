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

// Fuente opcional (Nerd Font) incrustada como @font-face con data URI, para no
// depender del acceso a ficheros del WebView. Si no está el .ttf, se omite y la
// app usa la monoespaciada del sistema.
const fontPath = path.join(
  root,
  'android/app/src/main/assets/fonts/JetBrainsMonoNF.ttf',
);
let fontFace = '';
if (fs.existsSync(fontPath)) {
  const b64 = fs.readFileSync(fontPath).toString('base64');
  fontFace =
    `@font-face{font-family:'JetBrainsMonoNF';font-style:normal;` +
    `font-weight:400;font-display:block;` +
    `src:url(data:font/ttf;base64,${b64}) format('truetype');}`;
  console.log(`  fuente embebida: ${(b64.length / 1024 / 1024).toFixed(1)} MB base64`);
}

// Evita cerrar el <script> prematuramente si el bundle contuviera "</script".
const safe = s => s.replace(/<\/script/gi, '<\\/script');

const html = `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>${fontFace}
${css}
html,body{margin:0;padding:0;height:100%;background:#0b0f14;overflow:hidden}
#term{position:absolute;inset:0;padding:4px}
/* Cursor propio: xterm sin foco (teclado nativo) no muestra cursor, así que lo
   dibujamos nosotros. Recuadro verde de marca sobre la celda del cursor; no
   tapa el carácter (solo borde) y se posiciona con transform desde bridge.js. */
:root{--lulo-cursor:#9be22d;--lulo-cursor-accent:#0b0f14}
.xterm .xterm-screen{position:relative}
#lulo-cur{
  position:absolute;top:0;left:0;z-index:5;pointer-events:none;
  box-sizing:border-box;border:2px solid var(--lulo-cursor);border-radius:1px;
  background:transparent;will-change:transform;
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
