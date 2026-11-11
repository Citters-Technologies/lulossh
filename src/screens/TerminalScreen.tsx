import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyBar } from '../keyboard/KeyBar';
import {
  applyCtrl,
  DEFAULT_LAYOUT,
  Modifier,
  ModifierState,
} from '../keyboard/model';
import { Ssh, sshEvents, toBase64 } from '../native/SshModule';
import { Host, hostLabel } from '../store/models';
import { newId, withUnlock } from '../store/vault';
import { TerminalHandle, TerminalView } from '../terminal/TerminalView';

const NO_MODS: ModifierState = { ctrl: false, alt: false, shift: false };

export function TerminalScreen({
  host,
  onClose,
  onHostKeyAccepted,
}: {
  host: Host;
  onClose(): void;
  /** Para guardar la huella y no volver a preguntar. */
  onHostKeyAccepted(fingerprint: string): void;
}) {
  const term = useRef<TerminalHandle>(null);
  // El id lo generamos aquí (no el nativo) para poder atender eventos como
  // hostKey mientras connect() todavía no ha terminado.
  const sessionId = useRef(newId());
  const connected = useRef(false);
  const started = useRef(false);
  const [status, setStatus] = useState('Conectando…');
  const [mods, setMods] = useState<ModifierState>(NO_MODS);
  const modsRef = useRef(mods);
  modsRef.current = mods;

  const send = useCallback((data: string) => {
    if (connected.current) {
      Ssh.write(sessionId.current, toBase64(data)).catch(() => {});
    }
  }, []);

  const toggleModifier = (m: Modifier) =>
    setMods(prev => ({ ...prev, [m]: !prev[m] }));

  // Teclas de la barra: ya vienen resueltas; solo se consumen los modificadores.
  const sendFromBar = (data: string) => {
    send(data);
    setMods(NO_MODS);
  };

  // Teclado del sistema: aplica Ctrl/Alt pegajosos de la barra.
  const onInput = (data: string) => {
    const m = modsRef.current;
    let out = data;
    if (data.length === 1) {
      if (m.ctrl) {
        out = applyCtrl(data) ?? data;
      }
      if (m.alt) {
        out = '\x1b' + out;
      }
      if (m.ctrl || m.alt) {
        setMods(NO_MODS);
      }
    }
    send(out);
  };

  const acceptedRef = useRef(onHostKeyAccepted);
  acceptedRef.current = onHostKeyAccepted;

  const handleEvent = useCallback((event: string, p: any) => {
    if (p.sessionId !== sessionId.current) {
      return;
    }
    if (event === 'data') {
      term.current?.write(p.base64);
    } else if (event === 'closed') {
      connected.current = false;
      setStatus('Desconectado' + (p.reason ? `: ${p.reason}` : ''));
    } else if (event === 'hostKey') {
      Alert.alert(
        p.changed ? '⚠ La huella del host ha cambiado' : 'Host nuevo',
        (p.changed
          ? 'Puede ser una reinstalación del servidor o un ataque ' +
            '(man-in-the-middle). No continúes si no lo esperabas.\n\n'
          : '') + `Huella:\n${p.fingerprint}\n\n¿Confiar y continuar?`,
        [
          {
            text: 'Cancelar',
            style: 'cancel',
            onPress: () => Ssh.acceptHostKey(p.sessionId, false),
          },
          {
            text: 'Confiar',
            style: p.changed ? 'destructive' : 'default',
            onPress: () => {
              acceptedRef.current(p.fingerprint);
              Ssh.acceptHostKey(p.sessionId, true);
            },
          },
        ],
        { cancelable: false },
      );
    }
  }, []);

  useEffect(() => {
    const subs = (['data', 'closed', 'hostKey', 'error'] as const).map(ev =>
      sshEvents.addListener(ev, (p: any) => handleEvent(ev, p)),
    );
    const id = sessionId.current;
    return () => {
      subs.forEach(s => s.remove());
      // También aborta una conexión a medias (p. ej. esperando la huella).
      Ssh.disconnect(id).catch(() => {});
    };
  }, [handleEvent]);

  const onReady = async (size: { cols: number; rows: number }) => {
    if (started.current) {
      return; // el WebView puede recargarse; no reconectar en silencio
    }
    started.current = true;
    try {
      await withUnlock(
        () =>
          Ssh.connect({
            sessionId: sessionId.current,
            host: host.host,
            port: host.port,
            username: host.username,
            auth: host.auth,
            knownHostFingerprint: host.fingerprint,
            ...size,
          }),
        `Conectar a ${host.name}`,
      );
      connected.current = true;
      setStatus('Conectado');
      term.current?.focus();
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setStatus('Error');
      // Mostrarlo también en la terminal, que es donde mira el usuario.
      term.current?.write(toBase64(`\r\n\x1b[31m✖ ${msg}\x1b[0m\r\n`));
    }
  };

  const onResize = (size: { cols: number; rows: number }) => {
    if (connected.current) {
      Ssh.resize(sessionId.current, size.cols, size.rows).catch(() => {});
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {host.name} · {hostLabel(host)}
        </Text>
        <Text style={styles.status} onPress={onClose}>
          {status} · Cerrar
        </Text>
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TerminalView
          ref={term}
          onReady={onReady}
          onResize={onResize}
          onInput={onInput}
        />
        <KeyBar
          layout={DEFAULT_LAYOUT}
          mods={mods}
          onToggleModifier={toggleModifier}
          onSend={sendFromBar}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0f14' },
  header: { flexDirection: 'row', justifyContent: 'space-between', padding: 8 },
  title: { color: '#d7dde5', fontWeight: '600' },
  status: { color: '#8fa1b3' },
});
