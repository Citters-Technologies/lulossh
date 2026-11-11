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

export interface TerminalHandle {
  /** Escribe bytes (base64) que llegan del host. */
  write(base64: string): void;
  focus(): void;
  clear(): void;
  clearSelection(): void;
  /** Pega texto como si viniera del teclado (con bracketed paste). */
  paste(text: string): void;
  setFontSize(px: number): void;
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
}

export const TerminalView = forwardRef<TerminalHandle, Props>(
  ({ onReady, onResize, onInput, onTap, onSelection }, ref) => {
    const web = useRef<WebViewRef>(null);

    const run = (js: string) => web.current?.injectJavaScript(`${js};true;`);

    useImperativeHandle(ref, () => ({
      // base64 solo contiene [A-Za-z0-9+/=], es seguro dentro de comillas.
      write: b64 => run(`window.lulo.write("${b64}")`),
      focus: () => run('window.lulo.focus()'),
      clear: () => run('window.lulo.clear()'),
      clearSelection: () => run('window.lulo.clearSelection()'),
      paste: text => run(`window.lulo.paste("${toBase64(text)}")`),
      setFontSize: px => run(`window.lulo.setFontSize(${Number(px) || 14})`),
    }));

    // Android: el teclado lo recibe una vista nativa (sin mayúsculas ni
    // autocorrección en ningún IME), no el textarea del WebView.
    const inputRef = useRef(onInput);
    inputRef.current = onInput;
    useEffect(() => {
      if (!NATIVE_KEYBOARD) {
        return;
      }
      const sub = sshEvents.addListener('termInput', (p: any) =>
        inputRef.current(p.data),
      );
      return () => {
        sub.remove();
        Ssh.hideKeyboard(true);
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
        Ssh.showKeyboard();
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
