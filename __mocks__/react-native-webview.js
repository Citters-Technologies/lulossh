// Mock para Jest: el WebView real necesita el módulo nativo.
const React = require('react');
const { View } = require('react-native');

const WebView = React.forwardRef((props, ref) => {
  React.useImperativeHandle(ref, () => ({ injectJavaScript: () => {} }));
  return React.createElement(View, { testID: 'webview' });
});

module.exports = { __esModule: true, default: WebView, WebView };
