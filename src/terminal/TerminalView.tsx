import React, { forwardRef, useImperativeHandle, useRef } from 'react';
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

export interface TerminalHandle {
  /** Escribe bytes (base64) que llegan del host. */
  write(base64: string): void;
  focus(): void;
  clear(): void;
}

interface Props {
  onReady(size: { cols: number; rows: number }): void;
  onResize(size: { cols: number; rows: number }): void;
  /** Texto escrito con el teclado del sistema. */
  onInput(data: string): void;
}

export const TerminalView = forwardRef<TerminalHandle, Props>(
  ({ onReady, onResize, onInput }, ref) => {
    const web = useRef<WebViewRef>(null);

    const run = (js: string) => web.current?.injectJavaScript(`${js};true;`);

    useImperativeHandle(ref, () => ({
      // base64 solo contiene [A-Za-z0-9+/=], es seguro dentro de comillas.
      write: b64 => run(`window.lulo.write("${b64}")`),
      focus: () => run('window.lulo.focus()'),
      clear: () => run('window.lulo.clear()'),
    }));

    const onMessage = (e: WebViewMessageEvent) => {
      let msg: any;
      try {
        msg = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }
      if (msg.type === 'ready') {
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
