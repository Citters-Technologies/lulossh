import React, { useCallback, useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ssh } from '../native/SshModule';
import { Button, colors } from '../ui/kit';

/** Pantalla de bloqueo: huella / cara / PIN del sistema (BiometricPrompt). */
export function LockScreen({ onUnlocked }: { onUnlocked(): void }) {
  const [error, setError] = useState<string | null>(null);

  const unlock = useCallback(async () => {
    setError(null);
    try {
      await Ssh.unlock('Desbloquear LuloSSH');
      onUnlocked();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }, [onUnlocked]);

  useEffect(() => {
    unlock();
  }, [unlock]);

  return (
    <SafeAreaView style={local.root}>
      <View style={local.center}>
        <Image
          source={require('../../assets/logo/lulossh-icon.png')}
          style={local.logo}
        />
        <Text style={local.title}>
          Lulo<Text style={local.accent}>SSH</Text>
        </Text>
        <Text style={local.sub}>Bloqueado</Text>
        {error && <Text style={local.error}>{error}</Text>}
      </View>
      <View style={local.bottom}>
        <Button title="🔓  Desbloquear" onPress={unlock} />
      </View>
    </SafeAreaView>
  );
}

const local = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  logo: { width: 112, height: 112, marginBottom: 12 },
  title: { color: colors.strong, fontSize: 28, fontWeight: '800' },
  accent: { color: colors.brand },
  sub: { color: colors.muted },
  error: { color: colors.danger, textAlign: 'center', marginTop: 12 },
  bottom: { paddingBottom: 16 },
});
