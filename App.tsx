import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  BackHandler,
  PermissionsAndroid,
  Platform,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { KeyBarEditorScreen } from './src/screens/KeyBarEditorScreen';
import { LockScreen } from './src/screens/LockScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { loadLockSettings, LockSettings, shouldRelock } from './src/ui/appLock';
import { colors } from './src/ui/kit';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { importFromJuiceSsh } from './src/import/ui';
import { LiveSession, Ssh } from './src/native/SshModule';
import { HostEditScreen } from './src/screens/HostEditScreen';
import { HostsScreen } from './src/screens/HostsScreen';
import { KeysScreen } from './src/screens/KeysScreen';
import { TerminalScreen } from './src/screens/TerminalScreen';
import { Host, validateHost } from './src/store/models';
import { newId } from './src/store/vault';
import { useStore } from './src/store/useStore';

const JUICE_PREF = 'juiceImport';

const appStyles = StyleSheet.create({
  blank: { flex: 1, backgroundColor: colors.bg },
});

type Route =
  | { name: 'hosts' }
  | { name: 'editHost'; host?: Host }
  | { name: 'keys'; from?: Route }
  | { name: 'settings' }
  | { name: 'keybar' }
  | {
      name: 'terminal';
      host: Host;
      sessionId: string;
      /** true: la sesión ya existe en segundo plano y se restaura. */
      resume: boolean;
    };

export default function App() {
  // Bloqueo con huella/PIN: al arrancar y al volver tras el tiempo elegido.
  // null = leyendo ajustes; el vault no se lee hasta desbloquear.
  const [locked, setLockedState] = useState<boolean | null>(null);
  const store = useStore(locked === false);
  const [route, setRoute] = useState<Route>({ name: 'hosts' });
  const [live, setLive] = useState<LiveSession[]>([]);
  const home = () => setRoute({ name: 'hosts' });
  const setLocked = (v: boolean) => {
    if (v) {
      // La terminal se desmonta mientras está bloqueado: al volver, restaurar
      // la sesión (sigue viva en nativo) en lugar de reconectar.
      setRoute(r => (r.name === 'terminal' ? { ...r, resume: true } : r));
    }
    setLockedState(v);
  };
  const lockSettings = useRef<LockSettings>({ enabled: true, afterSec: 60 });
  const backgroundAt = useRef<number | null>(null);
  useEffect(() => {
    loadLockSettings().then(s => {
      lockSettings.current = s;
      setLocked(s.enabled);
    });
    const sub = AppState.addEventListener('change', st => {
      if (st === 'background') {
        backgroundAt.current = Date.now();
      } else if (st === 'active' && backgroundAt.current != null) {
        const away = Date.now() - backgroundAt.current;
        backgroundAt.current = null;
        if (shouldRelock(lockSettings.current, away)) {
          setLocked(true);
        }
      }
    });
    return () => sub.remove();
  }, []);

  const refreshLive = useCallback(
    () =>
      Ssh.listSessions()
        .then(setLive)
        .catch(() => {}),
    [],
  );

  const hostsRef = useRef(store.hosts);
  hostsRef.current = store.hosts;
  const routeRef = useRef(route);
  routeRef.current = route;
  const storeRef = useRef(store);
  storeRef.current = store;

  const openLive = useCallback((s: LiveSession) => {
    // El host puede haberse borrado: mostrar al menos el título.
    const host: Host = hostsRef.current.find(h => h.id === s.hostId) ?? {
      id: s.hostId ?? s.sessionId,
      name: s.title,
      host: '',
      port: 22,
      username: '',
      auth: { type: 'password', password: '' },
    };
    setRoute({ name: 'terminal', host, sessionId: s.sessionId, resume: true });
  }, []);

  // Toque en la notificación de sesiones: abrir la sesión indicada.
  const checkPendingOpen = useCallback(async () => {
    const id = await Ssh.consumePendingOpen().catch(() => null);
    const sessions = await Ssh.listSessions().catch(() => [] as LiveSession[]);
    setLive(sessions);
    const target = sessions.find(s => s.sessionId === id);
    const r = routeRef.current;
    if (
      target &&
      !(r.name === 'terminal' && r.sessionId === target.sessionId)
    ) {
      openLive(target);
    }
  }, [openLive]);

  useEffect(() => {
    if (!store.loaded) {
      return;
    }
    checkPendingOpen();
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') {
        checkPendingOpen();
      }
    });
    return () => sub.remove();
  }, [store.loaded, checkPendingOpen]);

  useEffect(() => {
    if (route.name === 'hosts') {
      refreshLive();
    }
  }, [route, refreshLive]);

  // Al abrir: si JuiceSSH está instalado, ofrecer importar (hasta que se haga
  // o el usuario diga que no vuelva a preguntar).
  const juiceAsked = useRef(false);
  useEffect(() => {
    if (!store.loaded || juiceAsked.current) {
      return;
    }
    juiceAsked.current = true;
    (async () => {
      const done = await Ssh.prefGet(JUICE_PREF).catch(() => null);
      const installed = await Ssh.isJuiceSshInstalled().catch(() => false);
      if (done || !installed) {
        return;
      }
      Alert.alert(
        'JuiceSSH detectado',
        '¿Quieres importar tus conexiones y grupos de JuiceSSH? ' +
          '(Sus usuarios y claves no se pueden leer; se completan después.)',
        [
          {
            text: 'No volver a preguntar',
            style: 'destructive',
            onPress: () => Ssh.prefSet(JUICE_PREF, 'never').catch(() => {}),
          },
          { text: 'Ahora no', style: 'cancel' },
          {
            text: 'Importar',
            onPress: async () => {
              if (await importFromJuiceSsh(storeRef.current)) {
                Ssh.prefSet(JUICE_PREF, 'imported').catch(() => {});
              }
            },
          },
        ],
      );
    })();
  }, [store.loaded]);

  // Android 13+: permiso para la notificación de sesiones en segundo plano.
  useEffect(() => {
    if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
      PermissionsAndroid.request(
        'android.permission.POST_NOTIFICATIONS' as any,
      ).catch(() => {});
    }
  }, []);

  // Botón atrás de Android: vuelve a la pantalla anterior en lugar de salir.
  // Desde la terminal, la sesión sigue abierta en segundo plano.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (route.name === 'hosts') {
        return false;
      }
      setRoute(
        route.name === 'keys' && route.from
          ? route.from
          : route.name === 'keybar'
          ? { name: 'settings' }
          : { name: 'hosts' },
      );
      return true;
    });
    return () => sub.remove();
  }, [route]);

  const connect = (h: Host) => {
    // Hosts importados sin usuario o sin credenciales: completar antes.
    const missing =
      validateHost(h) ||
      (h.auth.type === 'password' && !h.auth.password
        ? 'Falta la contraseña o la clave'
        : null);
    if (missing) {
      Alert.alert('Completa el host', missing);
      setRoute({ name: 'editHost', host: h });
      return;
    }
    const open = () => {
      store
        .patchHost(h.id, {
          lastUsedAt: Date.now(),
          useCount: (h.useCount ?? 0) + 1,
        })
        .catch(() => {});
      setRoute({
        name: 'terminal',
        host: h,
        sessionId: newId(),
        resume: false,
      });
    };
    const existing = live.filter(s => s.hostId === h.id);
    if (existing.length) {
      Alert.alert(h.name, 'Ya tienes una sesión abierta con este host.', [
        { text: 'Nueva sesión', onPress: open },
        { text: 'Volver a la abierta', onPress: () => openLive(existing[0]) },
      ]);
      return;
    }
    open();
  };

  let screen: React.ReactNode;
  switch (route.name) {
    case 'hosts':
      screen = (
        <HostsScreen
          store={store}
          live={live}
          onResume={openLive}
          onDisconnect={s =>
            Ssh.disconnect(s.sessionId)
              .catch(() => {})
              .then(refreshLive)
          }
          onConnect={connect}
          onEdit={h => setRoute({ name: 'editHost', host: h })}
          onKeys={() => setRoute({ name: 'keys' })}
          onSettings={() => setRoute({ name: 'settings' })}
        />
      );
      break;
    case 'settings':
      screen = (
        <SettingsScreen
          onBack={home}
          onEditKeyBar={() => setRoute({ name: 'keybar' })}
          onLockChange={s => (lockSettings.current = s)}
        />
      );
      break;
    case 'keybar':
      screen = <KeyBarEditorScreen onBack={() => setRoute({ name: 'settings' })} />;
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
          key={route.sessionId}
          host={route.host}
          sessionId={route.sessionId}
          resume={route.resume}
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
      {/* Bloqueado: no se pinta nada de la app (las sesiones siguen en nativo). */}
      {locked === false ? (
        screen
      ) : locked === true ? (
        <LockScreen onUnlocked={() => setLocked(false)} />
      ) : (
        <View style={appStyles.blank} />
      )}
    </SafeAreaProvider>
  );
}
