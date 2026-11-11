// Corre dentro del WebView. Puente entre xterm.js y React Native.
/* eslint-env browser */
/* global Terminal, FitAddon */
(function () {
  var post = function (msg) {
    window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  };

  var term = new Terminal({
    cursorBlink: true,
    cursorStyle: 'block',
    // En Android el teclado va a una vista nativa y xterm nunca tiene el foco:
    // sin esto pinta el cursor "inactivo" (contorno casi invisible).
    cursorInactiveStyle: 'block',
    fontFamily: 'monospace',
    fontSize: 14,
    scrollback: 5000,
    allowProposedApi: true,
    theme: { background: '#0b0f14', foreground: '#d7dde5' },
  });
  var fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(document.getElementById('term'));

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

  // Toque en la terminal: pedir teclado a RN (o enfocar xterm si no hay nativo).
  document.getElementById('term').addEventListener('click', function () {
    if (nativeKeyboard) {
      post({ type: 'tap' });
    } else {
      term.focus();
    }
  });

  function doFit() {
    try {
      fit.fit();
      post({ type: 'resize', cols: term.cols, rows: term.rows });
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
    focus: function () {
      if (nativeKeyboard) {
        post({ type: 'tap' });
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
  };

  window.addEventListener('resize', doFit);
  new ResizeObserver(doFit).observe(document.getElementById('term'));
  doFit();
  post({ type: 'ready', cols: term.cols, rows: term.rows });
})();
