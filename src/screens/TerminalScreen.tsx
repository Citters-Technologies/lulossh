import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AiTool, detectCommand, parseDetect } from '../ai/tools';
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
import { useKeyboardHeight } from '../ui/useKeyboardHeight';

const NO_MODS: ModifierState = { ctrl: false, alt: false, shift: false };

const FONT_PREF = 'terminalFontSize';
const FONT_MIN = 8;
const FONT_MAX = 32;
const FONT_DEFAULT = 14;

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
  const keyboardHeight = useKeyboardHeight();
  const [aiTools, setAiTools] = useState<AiTool[]>([]);
  const [barVisible, setBarVisible] = useState(true);
  /** null: sin selección activa; '' : pulsación larga sobre vacío (solo Pegar). */
  const [selection, setSelection] = useState<string | null>(null);

  // Toque en la consola: con teclado abierto, ocultar teclado y botonera;
  // si no, mostrar ambos.
  const onTap = () => {
    if (keyboardHeight > 0) {
      Ssh.hideKeyboard(false);
      setBarVisible(false);
    } else {
      setBarVisible(true);
      Ssh.showKeyboard();
    }
  };

  const copySelection = () => {
    if (selection) {
      Ssh.copyText(selection);
    }
    term.current?.clearSelection();
    setSelection(null);
  };

  const paste = async () => {
    term.current?.clearSelection();
    setSelection(null);
    const text = await Ssh.pasteText().catch(() => null);
    if (!text) {
      return;
    }
    const lines = text.split(/\r?\n/).length;
    if (lines > 1) {
      Alert.alert(
        'Pegar varias líneas',
        `Vas a pegar ${lines} líneas; cada salto de línea puede ejecutar un comando.`,
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Pegar', onPress: () => term.current?.paste(text) },
        ],
      );
    } else {
      term.current?.paste(text);
    }
  };

  // Tamaño de letra: teclas de volumen, persistido entre sesiones.
  const fontSize = useRef(FONT_DEFAULT);
  const [fontHint, setFontHint] = useState<string | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => {
    Ssh.prefGet(FONT_PREF)
      .then(v => {
        const n = Number(v);
        if (n >= FONT_MIN && n <= FONT_MAX) {
          fontSize.current = n;
          term.current?.setFontSize(n);
        }
      })
      .catch(() => {});

    Ssh.setVolumeKeysEnabled(true);
    const sub = sshEvents.addListener('volumeKey', (p: any) => {
      const next = Math.min(
        FONT_MAX,
        Math.max(FONT_MIN, fontSize.current + (p.direction === 'up' ? 1 : -1)),
      );
      if (next === fontSize.current) {
        return;
      }
      fontSize.current = next;
      term.current?.setFontSize(next);
      Ssh.prefSet(FONT_PREF, String(next)).catch(() => {});
      setFontHint(`Letra ${next}`);
      clearTimeout(hintTimer.current);
      hintTimer.current = setTimeout(() => setFontHint(null), 1200);
    });
    return () => {
      Ssh.setVolumeKeysEnabled(false);
      sub.remove();
      clearTimeout(hintTimer.current);
    };
  }, []);

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
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const askDisconnect = () => {
    if (!connected.current) {
      onClose();
      return;
    }
    Alert.alert('Desconectar', `¿Cerrar la sesión con ${host.name}?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Desconectar', style: 'destructive', onPress: onClose },
    ]);
  };

  const handleEvent = useCallback((event: string, p: any) => {
    if (p.sessionId !== sessionId.current) {
      return;
    }
    if (event === 'data') {
      term.current?.write(p.base64);
    } else if (event === 'closed') {
      const wasConnected = connected.current;
      connected.current = false;
      if (wasConnected && !p.reason) {
        // Cierre limpio (exit / logout): volver a la lista de conexiones.
        closeRef.current();
        return;
      }
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
    // El WebView ya cargó: aplicar el tamaño guardado (puede cambiar cols/rows).
    if (fontSize.current !== FONT_DEFAULT) {
      term.current?.setFontSize(fontSize.current);
    }
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
      // ¿Hay CLIs de IA en el destino? (canal aparte, no se ve en la terminal)
      Ssh.exec(sessionId.current, detectCommand(), 8000)
        .then(out => setAiTools(parseDetect(out)))
        .catch(() => {});
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
    <SafeAreaView
      style={styles.root}
      // Con el teclado abierto, el hueco inferior lo pone keyboardHeight.
      edges={keyboardHeight > 0 ? ['top', 'left', 'right'] : undefined}
    >
      <View style={styles.header}>
        <View style={styles.titleBox}>
          <Text style={styles.title} numberOfLines={1}>
            {host.name} · {hostLabel(host)}
          </Text>
          <Text style={styles.status} numberOfLines={1}>
            {status}
          </Text>
        </View>
        <Pressable
          onPress={askDisconnect}
          hitSlop={8}
          style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
        >
          <Text style={styles.closeText}>
            {connected.current ? 'Desconectar' : 'Cerrar'}
          </Text>
        </Pressable>
      </View>
      <View style={[styles.body, { paddingBottom: keyboardHeight }]}>
        <TerminalView
          ref={term}
          onReady={onReady}
          onResize={onResize}
          onInput={onInput}
          onTap={onTap}
          onSelection={setSelection}
        />
        {selection !== null && (
          <View style={styles.selBar}>
            {selection !== '' && (
              <Pressable onPress={copySelection} style={styles.selBtn}>
                <Text style={styles.selText}>Copiar</Text>
              </Pressable>
            )}
            <Pressable onPress={paste} style={styles.selBtn}>
              <Text style={styles.selText}>Pegar</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                term.current?.clearSelection();
                setSelection(null);
              }}
              style={styles.selBtn}
            >
              <Text style={styles.selText}>✕</Text>
            </Pressable>
          </View>
        )}
        {aiTools.length > 0 && (
          <View style={styles.aiBar} pointerEvents="box-none">
            {aiTools.map(t => (
              <Pressable
                key={t.id}
                accessibilityLabel={`Reanudar chat de ${t.name}`}
                onPress={() => send(`${t.command}\r`)}
                onLongPress={() =>
                  Alert.alert(t.name, `Escribe “${t.command}” en la shell.`)
                }
                hitSlop={6}
                style={({ pressed }) => [
                  styles.aiBtn,
                  { borderColor: t.color },
                  pressed && styles.aiBtnPressed,
                ]}
              >
                <Text style={[styles.aiGlyph, { color: t.color }]}>
                  {t.glyph}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        {fontHint && (
          <View style={styles.hint} pointerEvents="none">
            <Text style={styles.hintText}>{fontHint}</Text>
          </View>
        )}
        {barVisible && (
          <KeyBar
            layout={DEFAULT_LAYOUT}
            mods={mods}
            onToggleModifier={toggleModifier}
            onSend={sendFromBar}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0f14' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 10,
  },
  titleBox: { flex: 1 },
  title: { color: '#d7dde5', fontWeight: '600' },
  status: { color: '#8fa1b3', fontSize: 12 },
  closeBtn: {
    borderWidth: 1,
    borderColor: '#c0504d',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pressed: { opacity: 0.6 },
  closeText: { color: '#ff7b72', fontWeight: '600' },
  body: { flex: 1 },
  hint: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
  },
  hintText: { color: '#fff', fontWeight: '600' },
  aiBar: {
    position: 'absolute',
    top: 8,
    right: 8,
    gap: 8,
  },
  aiBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(11,15,20,0.55)',
    opacity: 0.45,
  },
  aiBtnPressed: { opacity: 1 },
  selBar: {
    position: 'absolute',
    top: 8,
    alignSelf: 'center',
    flexDirection: 'row',
    backgroundColor: '#242d38',
    borderRadius: 10,
    overflow: 'hidden',
    elevation: 6,
  },
  selBtn: { paddingHorizontal: 16, paddingVertical: 10 },
  selText: { color: '#fff', fontWeight: '600' },
  aiGlyph: { fontSize: 18, fontWeight: '700' },
});
