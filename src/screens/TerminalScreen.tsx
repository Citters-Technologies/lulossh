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
import { ConnectOptions, Ssh, sshEvents, toBase64 } from '../native/SshModule';
import { TerminalHandle, TerminalView } from '../terminal/TerminalView';

type Params = Omit<ConnectOptions, 'cols' | 'rows'>;

const NO_MODS: ModifierState = { ctrl: false, alt: false, shift: false };

export function TerminalScreen({
  params,
  onClose,
}: {
  params: Params;
  onClose(): void;
}) {
  const term = useRef<TerminalHandle>(null);
  const sessionId = useRef<string | null>(null);
  const queue = useRef<{ event: string; payload: any }[]>([]);
  const [status, setStatus] = useState('Conectando…');
  const [mods, setMods] = useState<ModifierState>(NO_MODS);
  const modsRef = useRef(mods);
  modsRef.current = mods;

  const send = useCallback((data: string) => {
    if (sessionId.current) {
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

  const handleEvent = useCallback((event: string, p: any) => {
    if (p.sessionId !== sessionId.current) {
      return;
    }
    if (event === 'data') {
      term.current?.write(p.base64);
    } else if (event === 'closed') {
      setStatus('Desconectado' + (p.reason ? `: ${p.reason}` : ''));
    } else if (event === 'hostKey') {
      Alert.alert(
        p.changed ? '⚠ La huella del host ha cambiado' : 'Host nuevo',
        `Huella:\n${p.fingerprint}\n\n¿Confiar y continuar?`,
        [
          {
            text: 'Cancelar',
            style: 'cancel',
            onPress: () => Ssh.acceptHostKey(p.sessionId, false),
          },
          {
            text: 'Confiar',
            onPress: () => Ssh.acceptHostKey(p.sessionId, true),
          },
        ],
        { cancelable: false },
      );
    }
  }, []);

  useEffect(() => {
    // connect() devuelve el sessionId después de que ya puedan llegar eventos
    // (hostKey, data): se encolan hasta conocerlo y luego se procesan.
    const subs = (['data', 'closed', 'hostKey', 'error'] as const).map(ev =>
      sshEvents.addListener(ev, (p: any) => {
        if (sessionId.current) {
          handleEvent(ev, p);
        } else {
          queue.current.push({ event: ev, payload: p });
        }
      }),
    );
    return () => {
      subs.forEach(s => s.remove());
      if (sessionId.current) {
        Ssh.disconnect(sessionId.current).catch(() => {});
      }
    };
  }, [handleEvent]);

  const onReady = async (size: { cols: number; rows: number }) => {
    try {
      const id = await Ssh.connect({ ...params, ...size });
      sessionId.current = id;
      setStatus('Conectado');
      queue.current.splice(0).forEach(q => handleEvent(q.event, q.payload));
      term.current?.focus();
    } catch (e: any) {
      setStatus(`Error: ${e?.message ?? e}`);
    }
  };

  const onResize = (size: { cols: number; rows: number }) => {
    if (sessionId.current) {
      Ssh.resize(sessionId.current, size.cols, size.rows).catch(() => {});
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>
          {params.username}@{params.host}
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
