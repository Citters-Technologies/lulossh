import React, { useEffect, useState } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ssh } from '../native/SshModule';
import {
  loadLockSettings,
  LOCK_AFTER_OPTIONS,
  LOCK_AFTER_PREF,
  LOCK_PREF,
  LockSettings,
} from '../ui/appLock';
import { colors, Header, Segmented, styles } from '../ui/kit';

const REPO = 'https://github.com/Citters-Technologies/lulossh';

export function SettingsScreen({
  onBack,
  onEditKeyBar,
  onLockChange,
}: {
  onBack(): void;
  onEditKeyBar(): void;
  onLockChange(s: LockSettings): void;
}) {
  const [lock, setLock] = useState<LockSettings | null>(null);
  useEffect(() => {
    loadLockSettings().then(setLock);
  }, []);

  const saveLock = (next: LockSettings) => {
    setLock(next);
    onLockChange(next);
    Ssh.prefSet(LOCK_PREF, next.enabled ? 'on' : 'off').catch(() => {});
    Ssh.prefSet(LOCK_AFTER_PREF, String(next.afterSec)).catch(() => {});
  };

  const toggleLock = async (enabled: boolean) => {
    if (!lock) {
      return;
    }
    // Quitar el bloqueo exige demostrar que eres tú.
    if (!enabled) {
      try {
        await Ssh.unlock('Desactivar el bloqueo de LuloSSH');
      } catch {
        return;
      }
    }
    saveLock({ ...lock, enabled });
  };

  return (
    <SafeAreaView style={styles.screen}>
      <Header title="Ajustes" left={{ label: '‹ Volver', onPress: onBack }} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.section}>Seguridad</Text>
        <View style={local.card}>
          <View style={local.line}>
            <View style={local.lineText}>
              <Text style={local.title}>Bloquear con huella o PIN</Text>
              <Text style={local.sub}>
                Pide desbloquear al abrir la app y al volver a ella.
              </Text>
            </View>
            <Switch
              value={lock?.enabled ?? true}
              onValueChange={toggleLock}
              disabled={!lock}
            />
          </View>
          {lock?.enabled && (
            <>
              <Text style={[local.sub, local.gap]}>
                Pedirlo al volver después de
              </Text>
              <Segmented
                value={String(lock.afterSec)}
                onChange={v => saveLock({ ...lock, afterSec: Number(v) })}
                options={LOCK_AFTER_OPTIONS.map(o => ({ ...o }))}
              />
            </>
          )}
        </View>

        <Text style={styles.section}>Terminal</Text>
        <Item
          icon="⌨"
          title="Botonera de teclas"
          sub="Añade, quita y ordena las teclas de encima del teclado"
          onPress={onEditKeyBar}
        />

        <Text style={styles.section}>Acerca de</Text>
        <Item
          icon="🍊"
          title="LuloSSH"
          sub="Código abierto (AGPL-3.0) · Citters Technologies SLU"
          onPress={() => Linking.openURL(REPO)}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function Item({
  icon,
  title,
  sub,
  onPress,
}: {
  icon: string;
  title: string;
  sub: string;
  onPress(): void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [local.card, local.line, pressed && local.pressed]}
    >
      <Text style={local.icon}>{icon}</Text>
      <View style={local.lineText}>
        <Text style={local.title}>{title}</Text>
        <Text style={local.sub}>{sub}</Text>
      </View>
      <Text style={local.chev}>›</Text>
    </Pressable>
  );
}

const local = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
  },
  line: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  lineText: { flex: 1 },
  title: { color: '#fff', fontSize: 16, fontWeight: '600' },
  sub: { color: colors.muted, marginTop: 2, fontSize: 13 },
  gap: { marginTop: 12, marginBottom: 6 },
  icon: { fontSize: 20, width: 28, textAlign: 'center' },
  chev: { color: colors.muted, fontSize: 22 },
  pressed: { backgroundColor: colors.surface2 },
});
