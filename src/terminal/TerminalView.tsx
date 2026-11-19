import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import { Platform } from 'react-native';
import { Ssh, sshEvents, toBase64 } from '../native/SshModule';
import WebViewBase, {
  WebViewMessageEvent,
  WebViewProps,
} from 'react-native-webview';
import { TERMINAL_HTML } from './terminalHtml.generated';

// Los tipos de react-native-webview declaran `WebView<P = undefined>` y
// `WebViewProps & undefined` se reduce a `never`. Alias con tipos correctos.
type WebViewRef = WebViewBase<{}>;
const WebView = WebViewBase as unknown as React.ComponentType<
  WebViewProps & React.RefAttributes<WebViewRef>
>;

const NATIVE_KEYBOARD = Platform.OS === 'android';

/**
 * Flechas/Inicio/Fin sin modificadores en modo aplicación (DECCKM):
 * ESC [ A -> ESC O A, como haría xterm.
 */
function toAppCursor(data: string): string {
  // eslint-disable-next-line no-control-regex
  return data.replace(/^\x1b\[([ABCDHF])$/, '\x1bO$1');
}

export interface TerminalHandle {
  /** Escribe bytes (base64) que llegan del host. */
  write(base64: string): void;
  /** Historial de una sesión restaurada: se pinta oculto y se muestra al final. */
  replay(base64: string): void;
  /** Salida acumulada durante una pausa (varios trozos base64). */
  writeBatch(list: string[]): void;
  /** Borra y repinta con el historial. */
  resync(base64: string): void;
  /** 'gpu' (WebGL) o 'dom'. */
  setRenderer(which: string): void;
  focus(): void;
  clear(): void;
  clearSelection(): void;
  /** Pega texto como si viniera del teclado (con bracketed paste). */
  paste(text: string): void;
  setFontSize(px: number): void;
  /** Aplica una paleta de colores (objeto de tema de xterm). */
  setTheme(theme: object): void;
  /** Familia de fuente: 'system' o 'nerd'. */
  setFont(which: string): void;
}

interface Props {
  onReady(size: { cols: number; rows: number }): void;
  onResize(size: { cols: number; rows: number }): void;
  /** Texto escrito con el teclado del sistema. */
  onInput(data: string): void;
  /** Toque corto en la terminal (Android: alternar teclado y botonera). */
  onTap?(): void;
  /** Texto seleccionado con pulsación larga; null si se descarta. */
  onSelection?(text: string | null): void;
  /**
   * Con varias terminales en pantalla, solo la activa recibe el teclado
   * nativo (por defecto, sí).
   */
  inputEnabled?: boolean;
}

export const TerminalView = forwardRef<TerminalHandle, Props>(
  (
    { onReady, onResize, onInput, onTap, onSelection, inputEnabled = true },
    ref,
  ) => {
    const enabledRef = useRef(inputEnabled);
    enabledRef.current = inputEnabled;
    const web = useRef<WebViewRef>(null);

    const run = (js: string) => web.current?.injectJavaScript(`${js};true;`);

    useImperativeHandle(ref, () => ({
      // base64 solo contiene [A-Za-z0-9+/=], es seguro dentro de comillas.
      write: b64 => run(`window.lulo.write("${b64}")`),
      replay: b64 => run(`window.lulo.replay("${b64}")`),
      writeBatch: list =>
        run(`window.lulo.writeBatch(${JSON.stringify(list)})`),
      resync: b64 => run(`window.lulo.resync("${b64}")`),
      setRenderer: which =>
        run(`window.lulo.setRenderer(${JSON.stringify(which)})`),
      focus: () => run('window.lulo.focus()'),
      clear: () => run('window.lulo.clear()'),
      clearSelection: () => run('window.lulo.clearSelection()'),
      paste: text => run(`window.lulo.paste("${toBase64(text)}")`),
      setFontSize: px => run(`window.lulo.setFontSize(${Number(px) || 14})`),
      // JSON.stringify entrecomilla todo; seguro dentro de comillas simples.
      setTheme: theme =>
        run(`window.lulo.setTheme(${JSON.stringify(JSON.stringify(theme))})`),
      setFont: which => run(`window.lulo.setFont(${JSON.stringify(which)})`),
    }));

    // Android: el teclado lo recibe una vista nativa (sin mayúsculas ni
    // autocorrección en ningún IME), no el textarea del WebView.
    const inputRef = useRef(onInput);
    const appCursor = useRef(false);
    inputRef.current = onInput;
    useEffect(() => {
      if (!NATIVE_KEYBOARD) {
        return;
      }
      const sub = sshEvents.addListener('termInput', (p: any) => {
        if (enabledRef.current) {
          inputRef.current(appCursor.current ? toAppCursor(p.data) : p.data);
        }
      });
      return () => {
        sub.remove();
        // La vista de entrada es de todas: solo la suelta la que la usaba.
        if (enabledRef.current) {
          Ssh.hideKeyboard(true);
        }
      };
    }, []);

    const onMessage = (e: WebViewMessageEvent) => {
      let msg: any;
      try {
        msg = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }
      if (msg.type === 'tap') {
        onTap?.();
      } else if (msg.type === 'focus') {
        if (enabledRef.current) {
          Ssh.showKeyboard();
        }
      } else if (msg.type === 'selection') {
        onSelection?.(msg.text ?? '');
      } else if (msg.type === 'selectionCleared') {
        onSelection?.(null);
      } else if (msg.type === 'ready') {
        if (NATIVE_KEYBOARD) {
          run('window.lulo.useNativeKeyboard()');
        }
        onReady({ cols: msg.cols, rows: msg.rows });
      } else if (msg.type === 'resize') {
        onResize({ cols: msg.cols, rows: msg.rows });
      } else if (msg.type === 'renderer') {
        if (__DEV__) {
          console.log(`[terminal] dibujo: ${msg.gpu ? 'GPU (WebGL)' : 'DOM'}`);
        }
      } else if (msg.type === 'appCursor') {
        appCursor.current = !!msg.on;
      } else if (msg.type === 'input') {
        onInput(msg.data);
      }
    };

    return (
      <WebView
        ref={web}
        originWhitelist={['*']}
        source={{ html: TERMINAL_HTML }}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled={false}
        keyboardDisplayRequiresUserAction={false}
        hideKeyboardAccessoryView
        overScrollMode="never"
        style={{ flex: 1, backgroundColor: '#0b0f14' }}
      />
    );
  },
);
