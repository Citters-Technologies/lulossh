import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  BackHandler,
  LayoutAnimation,
  PermissionsAndroid,
  Platform,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { IdentitiesScreen } from './src/screens/IdentitiesScreen';
import { KeyBarEditorScreen } from './src/screens/KeyBarEditorScreen';
import { SessionsScreen } from './src/screens/SessionsScreen';
import { Tab, TabShell } from './src/ui/TabShell';
import { LockScreen } from './src/screens/LockScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { LicensesScreen } from './src/screens/LicensesScreen';
import {
  consumeExternalActivity,
  loadLockSettings,
  LockSettings,
  shouldRelock,
} from './src/ui/appLock';
import { colors, isLight } from './src/ui/kit';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { importFromJuiceSsh } from './src/import/ui';
import { LiveSession, Ssh, sshEvents } from './src/native/SshModule';
import { HostEditScreen } from './src/screens/HostEditScreen';
import { HostsScreen } from './src/screens/HostsScreen';
import { KeysScreen } from './src/screens/KeysScreen';
import { TerminalScreen } from './src/screens/TerminalScreen';
import { Host, validateHost } from './src/store/models';
import { newId } from './src/store/vault';
import { useStore } from './src/store/useStore';
import {
  EmptyPane,
  SessionTabs,
  SIDE_WIDTH,
  useSplitLayout,
} from './src/ui/SplitPanes';
import {
  MAX_PANES,
  paneCount,
  PaneLayout,
  PaneSession,
  visiblePanes,
  Workspace,
} from './src/ui/Workspace';

const JUICE_PREF = 'juiceImport';
const SIDE_PREF = 'splitSide';
const PANES_PREF = 'paneLayout';

const appStyles = StyleSheet.create({
  blank: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1 },
  row: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg },
  hidden: { display: 'none' },
  side: {
    width: SIDE_WIDTH,
    overflow: 'hidden',
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.surface2,
  },
  // Plegado con animación (ancho 0) en vez de display:none.
  sideCollapsed: { width: 0, borderRightWidth: 0 },
  sideInner: { width: SIDE_WIDTH, flex: 1 },
});

type Route =
  | { name: 'hosts' }
  | { name: 'editHost'; host?: Host }
  | { name: 'keys'; from?: Route }
  | { name: 'settings' }
  | { name: 'keybar' }
  | { name: 'licenses' }
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
  // 'hosts' es la vista de pestañas; `tab` dice cuál se ve.
  const [route, setRoute] = useState<Route>({ name: 'hosts' });
  const [tab, setTab] = useState<Tab>('hosts');
  const [visitedTabs, setVisitedTabs] = useState<Set<Tab>>(
    () => new Set<Tab>(['hosts']),
  );
  const [live, setLive] = useState<LiveSession[]>([]);
  const home = () => setRoute({ name: 'hosts' });
  // Tablet: lista a la izquierda y terminal a la derecha.
  const split = useSplitLayout();
  // Ocultar la lista para centrarse en la terminal (se recuerda).
  const [sideHidden, setSideHidden] = useState(false);
  useEffect(() => {
    Ssh.prefGet(SIDE_PREF)
      .then(v => setSideHidden(v === 'hidden'))
      .catch(() => {});
  }, []);
  const toggleSide = () => {
    // El panel se desliza en lugar de aparecer de golpe.
    LayoutAnimation.configureNext(
      LayoutAnimation.create(220, 'easeInEaseOut', 'scaleX'),
    );
    setSideHidden(h => {
      Ssh.prefSet(SIDE_PREF, h ? 'shown' : 'hidden').catch(() => {});
      return !h;
    });
  };

  // Tablet: hasta 4 terminales en pantalla. El teclado va al panel activo.
  const [paneLayout, setPaneLayoutState] = useState<PaneLayout>('single');
  const [panes, setPanes] = useState<(PaneSession | null)[]>(() =>
    Array(MAX_PANES).fill(null),
  );
  const [activePane, setActivePane] = useState(0);
  const panesRef = useRef(panes);
  panesRef.current = panes;
  const activePaneRef = useRef(activePane);
  activePaneRef.current = activePane;
  const splitRef = useRef(split);
  splitRef.current = split;
  useEffect(() => {
    Ssh.prefGet(PANES_PREF)
      .then(v => {
        if (v === 'single' || v === 'cols' || v === 'rows' || v === 'grid') {
          setPaneLayoutState(v);
        }
      })
      .catch(() => {});
  }, []);
  const setPaneLayout = (l: PaneLayout) => {
    setPaneLayoutState(l);
    // Con un solo panel se amplía el activo, sea cual sea.
    setActivePane(a => (l === 'single' || a < paneCount(l) ? a : 0));
    Ssh.prefSet(PANES_PREF, l).catch(() => {});
  };
  const anyPane = panes.some(Boolean);

  /**
   * Muestra una terminal. En tablet va al panel activo (o al que ya la
   * enseña); en móvil es una pantalla completa.
   */
  const showTerminal = useCallback((t: PaneSession) => {
    if (!splitRef.current) {
      setRoute({ name: 'terminal', ...t });
      return;
    }
    const cur = panesRef.current;
    const count = paneCount(layoutRef.current);
    const at = cur.findIndex(x => x?.sessionId === t.sessionId);
    if (at >= 0 && (count === 1 || at < count)) {
      // Ya tiene panel: activarlo. Con un solo panel es un "zoom" sobre el
      // activo, así que basta con cambiar cuál se amplía.
      setActivePane(at);
    } else {
      // Al panel activo. La que estaba ahí no se pierde: ocupa el hueco que
      // deja la nueva (intercambio) o un panel libre de los que no caben,
      // y vuelve a verse al pasar a una distribución con más paneles.
      const i = activePaneRef.current;
      setPanes(ps => {
        const next = ps.slice();
        const old = next[i];
        next[i] = t;
        if (at >= 0) {
          next[at] = old;
        } else if (old && old.sessionId !== t.sessionId) {
          const free = next.findIndex(
            (x, j) => !x && !visiblePanes(layoutRef.current, i).includes(j),
          );
          if (free >= 0) {
            next[free] = old;
          }
        }
        return next;
      });
    }
    setRoute({ name: 'hosts' });
  }, []);
  const liveRef = useRef(live);
  liveRef.current = live;
  const layoutRef = useRef(paneLayout);
  layoutRef.current = paneLayout;
  const toggleSideRef = useRef(() => {});
  toggleSideRef.current = toggleSide;

  /** Sesiones cuya terminal ya se montó alguna vez en un panel. */
  const mountedSessions = useRef(new Set<string>());

  const closePane = (i: number) =>
    setPanes(ps => ps.map((x, j) => (j === i ? null : x)));
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
        const ownPicker = consumeExternalActivity();
        if (!ownPicker && shouldRelock(lockSettings.current, away)) {
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

  const openLive = useCallback(
    (s: LiveSession) => {
      // El host puede haberse borrado: mostrar al menos el título.
      const host: Host = hostsRef.current.find(h => h.id === s.hostId) ?? {
        id: s.hostId ?? s.sessionId,
        name: s.title,
        host: '',
        port: 22,
        username: '',
        auth: { type: 'password', password: '' },
      };
      showTerminal({ host, sessionId: s.sessionId, resume: true });
    },
    [showTerminal],
  );

  // Atajos del teclado físico: cambiar de panel/sesión y mostrar la lista.
  useEffect(() => {
    const cycle = (dir: number) => {
      if (splitRef.current) {
        const count = paneCount(layoutRef.current);
        if (count > 1) {
          setActivePane(a => (a + dir + count) % count);
          return;
        }
      }
      const ls = liveRef.current;
      if (ls.length < 2) {
        return;
      }
      const r = routeRef.current;
      const cur = splitRef.current
        ? panesRef.current[activePaneRef.current]?.sessionId
        : r.name === 'terminal'
        ? r.sessionId
        : undefined;
      const i = ls.findIndex(x => x.sessionId === cur);
      openLive(ls[(i + dir + ls.length) % ls.length]);
    };
    const sub = sshEvents.addListener('termShortcut', (p: any) => {
      const a: string = p.action;
      if (a === 'nextPane' || a === 'prevPane') {
        cycle(a === 'nextPane' ? 1 : -1);
      } else if (a.startsWith('pane')) {
        const n = Number(a.slice(4)) - 1;
        // Con un solo panel, Ctrl+Shift+N amplía el panel N.
        const max =
          layoutRef.current === 'single'
            ? MAX_PANES
            : paneCount(layoutRef.current);
        if (splitRef.current && n < max) {
          setActivePane(n);
        }
      } else if (a === 'toggleSide' && splitRef.current) {
        toggleSideRef.current();
      }
    });
    return () => sub.remove();
  }, [openLive]);

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
        // Tras segundo plano la conexión pudo morir sin avisar.
        Ssh.probeSessions();
      }
    });
    return () => sub.remove();
  }, [store.loaded, checkPendingOpen]);

  useEffect(() => {
    if (route.name === 'hosts' || route.name === 'terminal') {
      refreshLive();
    }
  }, [route, refreshLive]);

  // En tablet las pestañas de sesiones están a la vista: mantenerlas al día
  // (una sesión nueva aparece al terminar de conectar).
  useEffect(() => {
    if (!split || !anyPane) {
      return;
    }
    const t = setInterval(refreshLive, 3000);
    return () => clearInterval(t);
  }, [split, anyPane, refreshLive]);

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
        if (tab !== 'hosts') {
          setTab('hosts');
          return true;
        }
        return false;
      }
      setRoute(
        route.name === 'keys' && route.from
          ? route.from
          : route.name === 'keybar' || route.name === 'licenses'
          ? { name: 'settings' }
          : { name: 'hosts' },
      );
      return true;
    });
    return () => sub.remove();
  }, [route, tab]);

  const connect = (stored: Host) => {
    // Credenciales efectivas: las de su identidad, si usa una.
    const h = store.resolve(stored);
    // Hosts importados sin usuario o sin credenciales: completar antes.
    const missing =
      validateHost(h) ||
      (h.auth.type === 'password' && !h.auth.password
        ? 'Falta la contraseña o la clave'
        : null);
    if (missing) {
      Alert.alert(
        'Completa el host',
        `${missing}. Edítalo o asígnale una identidad.`,
      );
      setRoute({ name: 'editHost', host: stored });
      return;
    }
    const open = () => {
      store
        .patchHost(h.id, {
          lastUsedAt: Date.now(),
          useCount: (h.useCount ?? 0) + 1,
        })
        .catch(() => {});
      showTerminal({ host: h, sessionId: newId(), resume: false });
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

  // Vista de pestañas: se monta una vez y se queda montada (oculta) al ir a
  // otras pantallas o pestañas. Reconstruir la lista de cientos de hosts en
  // cada cambio era lo que hacía lenta la pestaña Hosts.
  const disconnect = (s: LiveSession) =>
    Ssh.disconnect(s.sessionId)
      .catch(() => {})
      .then(refreshLive);
  const pane = (t: Tab, el: React.ReactNode) =>
    visitedTabs.has(t) ? el : null;
  const peek = (t: Tab) =>
    setVisitedTabs(v => (v.has(t) ? v : new Set(v).add(t)));
  const tabsView = (
    <TabShell
      tab={tab}
      onTab={t => {
        setTab(t);
        peek(t);
        if (t === 'sessions') {
          refreshLive();
        }
      }}
      onPeek={peek}
      sessionsCount={live.length}
      onSettings={() => setRoute({ name: 'settings' })}
      action={
        tab === 'hosts'
          ? { label: '＋ Host', onPress: () => setRoute({ name: 'editHost' }) }
          : undefined
      }
      panes={{
        hosts: pane(
          'hosts',
          <HostsScreen
            store={store}
            live={live}
            onResume={openLive}
            onDisconnect={disconnect}
            onConnect={connect}
            onEdit={h => setRoute({ name: 'editHost', host: h })}
          />,
        ),
        sessions: pane(
          'sessions',
          <SessionsScreen
            live={live}
            onResume={openLive}
            onDisconnect={s => Ssh.disconnect(s.sessionId).catch(() => {})}
            onRefresh={refreshLive}
          />,
        ),
        identities: pane(
          'identities',
          <IdentitiesScreen
            store={store}
            onKeys={() => {
              setTab('keys');
              setVisitedTabs(v => new Set(v).add('keys'));
            }}
          />,
        ),
        keys: pane(
          'keys',
          <KeysScreen store={store} onBack={() => setTab('hosts')} embedded />,
        ),
      }}
    />
  );

  // Dos paneles solo para la lista y la terminal; el resto (ajustes, editar
  // host…) ocupa toda la pantalla.
  const paneOn = split && route.name === 'hosts';

  let screen: React.ReactNode = null;
  switch (route.name) {
    case 'hosts':
      break; // la vista de pestañas siempre montada (abajo)
    case 'settings':
      screen = (
        <SettingsScreen
          store={store}
          onBack={home}
          onEditKeyBar={() => setRoute({ name: 'keybar' })}
          onLicenses={() => setRoute({ name: 'licenses' })}
          onLockChange={s => (lockSettings.current = s)}
        />
      );
      break;
    case 'keybar':
      screen = (
        <KeyBarEditorScreen onBack={() => setRoute({ name: 'settings' })} />
      );
      break;
    case 'licenses':
      screen = <LicensesScreen onBack={() => setRoute({ name: 'settings' })} />;
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
          onOsDetected={os =>
            store.patchHost(route.host.id, { os }).catch(() => {})
          }
        />
      );
      break;
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isLight ? 'dark-content' : 'light-content'} />
      {/* Bloqueado: no se pinta nada de la app (las sesiones siguen en nativo). */}
      {locked === false ? (
        // Misma estructura siempre: las terminales no se desmontan (ni
        // reconectan) al ir a Ajustes o al cambiar la distribución.
        <View style={paneOn ? appStyles.row : appStyles.fill}>
          <View
            style={
              paneOn
                ? [
                    appStyles.side,
                    sideHidden && anyPane && appStyles.sideCollapsed,
                  ]
                : route.name === 'hosts'
                ? appStyles.fill
                : appStyles.hidden
            }
          >
            <View style={paneOn ? appStyles.sideInner : appStyles.fill}>
              {tabsView}
            </View>
          </View>
          {split && (
            <View style={paneOn ? appStyles.fill : appStyles.hidden}>
              {anyPane ? (
                <>
                  <SessionTabs
                    live={live}
                    current={panes[activePane]?.sessionId ?? ''}
                    currentTitle={panes[activePane]?.host.name ?? ''}
                    onOpen={openLive}
                    sideHidden={sideHidden}
                    onToggleSide={toggleSide}
                    layout={paneLayout}
                    onLayoutChange={setPaneLayout}
                    shown={visiblePanes(paneLayout, activePane)
                      .map(j => panes[j]?.sessionId ?? '')
                      .filter(Boolean)}
                  />
                  <Workspace
                    layout={paneLayout}
                    panes={panes}
                    active={activePane}
                    onActivate={setActivePane}
                    renderPane={(i, pn, isActive, shownPane) => {
                      const firstMount = !mountedSessions.current.has(
                        pn.sessionId,
                      );
                      const el = (
                        <TerminalScreen
                          key={pn.sessionId}
                          host={pn.host}
                          sessionId={pn.sessionId}
                          // Ya se abrió antes (p. ej. panel que se ocultó y
                          // vuelve): restaurar en lugar de conectar de nuevo.
                          resume={
                            pn.resume ||
                            mountedSessions.current.has(pn.sessionId)
                          }
                          onClose={() => closePane(i)}
                          onHostKeyAccepted={fp =>
                            store
                              .patchHost(pn.host.id, { fingerprint: fp })
                              .catch(() => {})
                          }
                          onOsDetected={os =>
                            store.patchHost(pn.host.id, { os }).catch(() => {})
                          }
                          inPane
                          active={isActive}
                          onActivate={() => setActivePane(i)}
                          keyboardPad={false}
                          visible={paneOn && shownPane}
                          onShowSide={
                            sideHidden && (i === 0 || i === 2)
                              ? toggleSide
                              : undefined
                          }
                        />
                      );
                      if (firstMount) {
                        mountedSessions.current.add(pn.sessionId);
                      }
                      return el;
                    }}
                  />
                </>
              ) : (
                <EmptyPane sessions={live.length} />
              )}
            </View>
          )}
          <View
            style={
              !paneOn && route.name !== 'hosts'
                ? appStyles.fill
                : appStyles.hidden
            }
          >
            {screen}
          </View>
        </View>
      ) : locked === true ? (
        <LockScreen onUnlocked={() => setLocked(false)} />
      ) : (
        <View style={appStyles.blank} />
      )}
    </SafeAreaProvider>
  );
}
