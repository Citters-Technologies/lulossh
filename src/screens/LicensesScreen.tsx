import React from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { APP_LICENSE, COMPONENTS } from '../legal/licenses';
import { colors, Header, styles } from '../ui/kit';

/** Componentes de terceros y sus licencias (como la sección de JuiceSSH). */
export function LicensesScreen({ onBack }: { onBack(): void }) {
  const open = (url: string) => Linking.openURL(url).catch(() => {});
  return (
    <SafeAreaView style={styles.screen}>
      <Header
        title="Componentes y licencias"
        left={{ label: '‹ Volver', onPress: onBack }}
      />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.section}>Esta aplicación</Text>
        <Pressable
          style={({ pressed }) => [local.card, pressed && local.pressed]}
          onPress={() => open(APP_LICENSE.url)}
        >
          <Text style={local.name}>{APP_LICENSE.name}</Text>
          <Text style={local.lic}>{APP_LICENSE.license}</Text>
          <Text style={local.use}>© {APP_LICENSE.holder}</Text>
          <Text style={local.use}>
            Código abierto. El código fuente completo está en GitHub; esta
            pantalla reconoce las librerías de terceros que incluye.
          </Text>
          <Text style={local.link}>{APP_LICENSE.url}</Text>
        </Pressable>

        <Text style={styles.section}>Componentes de terceros</Text>
        {COMPONENTS.map(c => (
          <Pressable
            key={c.name}
            style={({ pressed }) => [local.card, pressed && local.pressed]}
            onPress={() => open(c.url)}
          >
            <View style={local.row}>
              <Text style={local.name}>{c.name}</Text>
              <Text style={local.badge}>{c.license}</Text>
            </View>
            <Text style={local.use}>{c.use}</Text>
            <Text style={local.link}>{c.url}</Text>
          </Pressable>
        ))}

        <Text style={local.foot}>
          Cada componente se usa bajo su propia licencia, que conserva su
          titular. Toca uno para abrir su proyecto.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const local = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    gap: 4,
  },
  pressed: { backgroundColor: colors.surface2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  name: { color: '#fff', fontSize: 16, fontWeight: '700' },
  lic: { color: colors.accent, fontWeight: '700' },
  badge: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    backgroundColor: colors.surface2,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: 'hidden',
  },
  use: { color: colors.muted, fontSize: 13 },
  link: { color: '#7fb0ff', fontSize: 12 },
  foot: {
    color: '#5b6b7c',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 12,
  },
});
