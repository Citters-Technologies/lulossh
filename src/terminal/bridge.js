// Corre dentro del WebView. Puente entre xterm.js y React Native.
/* eslint-env browser */
/* global Terminal, FitAddon */
(function () {
  var post = function (msg) {
    window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  };

  var term = new Terminal({
    cursorBlink: true,
    fontFamily: 'monospace',
    fontSize: 14,
    scrollback: 5000,
    allowProposedApi: true,
    theme: { background: '#0b0f14', foreground: '#d7dde5' },
  });
  var fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(document.getElementById('term'));

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
      doFit();
    },
    focus: function () {
      term.focus();
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
