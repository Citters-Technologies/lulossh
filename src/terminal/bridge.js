// Corre dentro del WebView. Puente entre xterm.js y React Native.
/* eslint-env browser */
/* global Terminal, FitAddon */
(function () {
  var post = function (msg) {
    window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  };

  var term = new Terminal({
    cursorBlink: false,
    cursorStyle: 'block',
    // Con teclado nativo xterm nunca tiene foco y su cursor "inactivo" queda
    // invisible. Lo desactivamos ('none') y dibujamos uno propio (ver abajo).
    cursorInactiveStyle: 'none',
    fontFamily: 'monospace',
    fontSize: 14,
    scrollback: 5000,
    allowProposedApi: true,
    theme: {
      background: '#0b0f14',
      foreground: '#d7dde5',
      // Cursor en verde de marca, bien visible aunque xterm esté sin foco.
      cursor: '#9be22d',
      cursorAccent: '#0b0f14',
    },
  });
  var fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(document.getElementById('term'));

  // ---- Cursor propio -----------------------------------------------------
  // xterm, sin foco (teclado nativo), no pinta un cursor visible por más que
  // se fuerce. Dibujamos un recuadro verde que seguimos con la API pública
  // del buffer: siempre visible y fácil de localizar al moverse por el prompt.
  var curEl = document.createElement('div');
  curEl.id = 'lulo-cur';
  var screenEl = term.element.querySelector('.xterm-screen');
  (screenEl || term.element).appendChild(curEl);

  function drawCursor() {
    try {
      var buf = term.buffer.active;
      // Fila en pantalla = fila absoluta del cursor - desplazamiento visible.
      var screenRow = buf.baseY + buf.cursorY - buf.viewportY;
      var hidden = false;
      try {
        hidden = term._core._coreService.isCursorHidden;
      } catch (e) {}
      if (hidden || screenRow < 0 || screenRow >= term.rows) {
        curEl.style.display = 'none';
        return;
      }
      var sc = term.element.querySelector('.xterm-screen');
      if (!sc) {
        return;
      }
      var r = sc.getBoundingClientRect();
      var cw = r.width / term.cols;
      var ch = r.height / term.rows;
      curEl.style.display = 'block';
      curEl.style.width = cw + 'px';
      curEl.style.height = ch + 'px';
      curEl.style.transform =
        'translate(' + buf.cursorX * cw + 'px,' + screenRow * ch + 'px)';
    } catch (e) {}
  }
  term.onRender(drawCursor);
  term.onCursorMove(drawCursor);
  term.onResize(drawCursor);

  // xterm recibe el teclado por un <textarea> oculto. Sin esto, el teclado de
  // Android lo trata como texto normal: mayúscula inicial, autocorrección y
  // sugerencias, que rompen los comandos.
  var ta = term.textarea;
  if (ta) {
    ta.setAttribute('autocapitalize', 'none');
    ta.setAttribute('autocorrect', 'off');
    ta.setAttribute('autocomplete', 'off');
    ta.setAttribute('spellcheck', 'false');
  }

  // Modo "teclado nativo": RN gestiona el teclado con su propia vista (sin
  // mayúsculas en ningún IME). El textarea de xterm no debe abrir teclado.
  var nativeKeyboard = false;

  // ---- Gestos táctiles -------------------------------------------------
  //  - toque corto: RN muestra/oculta teclado y botonera (o enfoca xterm)
  //  - pulsación larga: selecciona la palabra; arrastrar amplía la selección
  //  - al soltar tras seleccionar: RN muestra Copiar / Pegar
  var el = document.getElementById('term');
  var LONG_MS = 450;
  var MOVE_PX = 10;
  var touch = null; // {x, y, moved, timer, selecting, anchor}

  function cellAt(x, y) {
    var screen = term.element.querySelector('.xterm-screen');
    var r = screen.getBoundingClientRect();
    var cw = r.width / term.cols;
    var ch = r.height / term.rows;
    var col = Math.min(term.cols - 1, Math.max(0, Math.floor((x - r.left) / cw)));
    var row = Math.min(term.rows - 1, Math.max(0, Math.floor((y - r.top) / ch)));
    return { col: col, row: row + term.buffer.active.viewportY };
  }

  function lineText(row) {
    var line = term.buffer.active.getLine(row);
    return line ? line.translateToString(false) : '';
  }

  function selectRange(a, b) {
    var s = a, e = b;
    if (b.row < a.row || (b.row === a.row && b.col < a.col)) {
      s = b;
      e = a;
    }
    var len = (e.row - s.row) * term.cols + (e.col - s.col) + 1;
    term.select(s.col, s.row, len);
  }

  /** Palabra bajo el dedo (caracteres no blancos); devuelve sus extremos. */
  function wordAt(c) {
    var text = lineText(c.row);
    var isWord = function (ch) {
      return ch && !/\s/.test(ch);
    };
    if (!isWord(text[c.col])) {
      return { start: c, end: c };
    }
    var s = c.col, e = c.col;
    while (s > 0 && isWord(text[s - 1])) s--;
    while (e < text.length - 1 && isWord(text[e + 1])) e++;
    return { start: { col: s, row: c.row }, end: { col: e, row: c.row } };
  }

  el.addEventListener(
    'touchstart',
    function (ev) {
      if (ev.touches.length !== 1) {
        touch = null;
        return;
      }
      var t = ev.touches[0];
      touch = { x: t.clientX, y: t.clientY, moved: false, selecting: false };
      touch.timer = setTimeout(function () {
        if (!touch || touch.moved) return;
        touch.selecting = true;
        var w = wordAt(cellAt(touch.x, touch.y));
        touch.anchor = w.start;
        selectRange(w.start, w.end);
        if (navigator.vibrate) navigator.vibrate(15);
      }, LONG_MS);
    },
    { passive: true },
  );

  el.addEventListener(
    'touchmove',
    function (ev) {
      if (!touch) return;
      var t = ev.touches[0];
      if (touch.selecting) {
        ev.preventDefault(); // no desplazar mientras se selecciona
        selectRange(touch.anchor, cellAt(t.clientX, t.clientY));
        return;
      }
      if (Math.abs(t.clientX - touch.x) > MOVE_PX || Math.abs(t.clientY - touch.y) > MOVE_PX) {
        touch.moved = true; // es un desplazamiento, no un toque
        clearTimeout(touch.timer);
      }
    },
    { passive: false },
  );

  el.addEventListener('touchend', function (ev) {
    if (!touch) return;
    clearTimeout(touch.timer);
    var t = touch;
    touch = null;
    if (t.selecting) {
      ev.preventDefault();
      post({ type: 'selection', text: term.getSelection() });
      return;
    }
    if (t.moved) return;
    if (term.hasSelection()) {
      term.clearSelection(); // un toque fuera descarta la selección
      post({ type: 'selectionCleared' });
      return;
    }
    if (nativeKeyboard) {
      post({ type: 'tap' });
    } else {
      term.focus();
    }
  });

  el.addEventListener('touchcancel', function () {
    if (touch) clearTimeout(touch.timer);
    touch = null;
  });

  function doFit() {
    try {
      fit.fit();
      post({ type: 'resize', cols: term.cols, rows: term.rows });
      drawCursor();
    } catch (e) {}
  }

  // Entrada del usuario (teclado del sistema): se envía tal cual a RN.
  term.onData(function (data) {
    post({ type: 'input', data: data });
  });

  // Decodifica base64 -> bytes -> escribe (xterm maneja UTF-8 por Uint8Array).
  window.lulo = {
    write: function (b64) {
      var bin = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      term.write(bytes);
    },
    setFontSize: function (n) {
      term.options.fontSize = n;
      // Esperar al re-render para medir bien las celdas nuevas.
      requestAnimationFrame(doFit);
    },
    /** Aplica una paleta (JSON del tema): colores de xterm + cursor + fondo. */
    setTheme: function (json) {
      try {
        var c = JSON.parse(json);
        term.options.theme = c;
        var root = document.documentElement;
        root.style.setProperty('--lulo-cursor', c.cursor || '#9be22d');
        root.style.setProperty('--lulo-cursor-accent', c.cursorAccent || c.background || '#0b0f14');
        if (c.background) {
          document.body.style.background = c.background;
        }
      } catch (e) {}
    },
    focus: function () {
      if (nativeKeyboard) {
        post({ type: 'focus' }); // abrir (no alternar) el teclado
      } else {
        term.focus();
      }
    },
    useNativeKeyboard: function () {
      nativeKeyboard = true;
      if (ta) {
        ta.setAttribute('inputmode', 'none'); // no abrir el IME desde el WebView
        ta.blur();
      }
    },
    clear: function () {
      term.clear();
    },
    clearSelection: function () {
      term.clearSelection();
    },
    /** Pegar texto UTF-8 (base64): xterm aplica bracketed paste si la app lo pide. */
    paste: function (b64) {
      var bin = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      term.paste(new TextDecoder().decode(bytes));
    },
  };

  window.addEventListener('resize', doFit);
  new ResizeObserver(doFit).observe(document.getElementById('term'));
  doFit();
  post({ type: 'ready', cols: term.cols, rows: term.rows });
})();
