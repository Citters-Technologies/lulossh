import React, { useEffect, useState } from 'react';
import { BackHandler, StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { HostEditScreen } from './src/screens/HostEditScreen';
import { HostsScreen } from './src/screens/HostsScreen';
import { KeysScreen } from './src/screens/KeysScreen';
import { TerminalScreen } from './src/screens/TerminalScreen';
import { Host } from './src/store/models';
import { useStore } from './src/store/useStore';

type Route =
  | { name: 'hosts' }
  | { name: 'editHost'; host?: Host }
  | { name: 'keys'; from?: Route }
  | { name: 'terminal'; host: Host };

export default function App() {
  const store = useStore();
  const [route, setRoute] = useState<Route>({ name: 'hosts' });
  const home = () => setRoute({ name: 'hosts' });

  // Botón atrás de Android: vuelve a la pantalla anterior en lugar de salir.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (route.name === 'hosts') {
        return false;
      }
      setRoute(
        route.name === 'keys' && route.from ? route.from : { name: 'hosts' },
      );
      return true;
    });
    return () => sub.remove();
  }, [route]);

  let screen: React.ReactNode;
  switch (route.name) {
    case 'hosts':
      screen = (
        <HostsScreen
          store={store}
          onConnect={h => {
            store.patchHost(h.id, { lastUsedAt: Date.now() }).catch(() => {});
            setRoute({ name: 'terminal', host: h });
          }}
          onEdit={h => setRoute({ name: 'editHost', host: h })}
          onKeys={() => setRoute({ name: 'keys' })}
        />
      );
      break;
    case 'editHost':
      screen = (
        <HostEditScreen
          key={route.host?.id ?? 'new'}
          store={store}
          host={route.host}
          onDone={home}
          onKeys={() => setRoute({ name: 'keys', from: route })}
        />
      );
      break;
    case 'keys':
      screen = (
        <KeysScreen
          store={store}
          onBack={() => setRoute(route.from ?? { name: 'hosts' })}
        />
      );
      break;
    case 'terminal':
      screen = (
        <TerminalScreen
          host={route.host}
          onClose={home}
          onHostKeyAccepted={fp =>
            store.patchHost(route.host.id, { fingerprint: fp }).catch(() => {})
          }
        />
      );
      break;
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      {screen}
    </SafeAreaProvider>
  );
}
