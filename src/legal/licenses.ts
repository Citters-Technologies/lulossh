/**
 * Componentes de terceros que LuloSSH incluye o enlaza, con su licencia.
 * Lista hecha a mano a partir de package.json y android/app/build.gradle;
 * al añadir o quitar una dependencia, actualízala aquí.
 */
export interface Component {
  name: string;
  license: string;
  /** Para qué se usa, en una línea. */
  use: string;
  url: string;
}

/** La propia app. */
export const APP_LICENSE = {
  name: 'LuloSSH',
  license: 'AGPL-3.0-or-later',
  holder: 'Citters Technologies SLU',
  url: 'https://github.com/Citters-Technologies/lulossh',
};

export const COMPONENTS: Component[] = [
  {
    name: 'React Native',
    license: 'MIT',
    use: 'Marco de la aplicación (UI multiplataforma).',
    url: 'https://github.com/facebook/react-native',
  },
  {
    name: 'React',
    license: 'MIT',
    use: 'Librería de interfaz.',
    url: 'https://github.com/facebook/react',
  },
  {
    name: 'Hermes',
    license: 'MIT',
    use: 'Motor de JavaScript en Android.',
    url: 'https://github.com/facebook/hermes',
  },
  {
    name: 'sshj',
    license: 'Apache-2.0',
    use: 'Cliente SSH nativo (conexión, canales, claves).',
    url: 'https://github.com/hierynomus/sshj',
  },
  {
    name: 'Bouncy Castle',
    license: 'MIT (Bouncy Castle License)',
    use: 'Criptografía: claves, cifrado de copias y del vault.',
    url: 'https://www.bouncycastle.org/',
  },
  {
    name: 'xterm.js',
    license: 'MIT',
    use: 'Emulador de terminal dentro de la consola.',
    url: 'https://github.com/xtermjs/xterm.js',
  },
  {
    name: 'xterm addon-fit',
    license: 'MIT',
    use: 'Ajuste de la terminal al tamaño de la pantalla.',
    url: 'https://github.com/xtermjs/xterm.js',
  },
  {
    name: 'react-native-webview',
    license: 'MIT',
    use: 'WebView que aloja la terminal.',
    url: 'https://github.com/react-native-webview/react-native-webview',
  },
  {
    name: 'react-native-safe-area-context',
    license: 'MIT',
    use: 'Márgenes seguros (notch, barras del sistema).',
    url: 'https://github.com/AppAndFlow/react-native-safe-area-context',
  },
  {
    name: 'AndroidX Biometric',
    license: 'Apache-2.0',
    use: 'Desbloqueo por huella o PIN.',
    url: 'https://developer.android.com/jetpack/androidx/releases/biometric',
  },
  {
    name: 'SLF4J',
    license: 'MIT',
    use: 'Registro interno de la librería SSH.',
    url: 'https://www.slf4j.org/',
  },
];
