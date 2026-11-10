import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ConnectOptions } from '../native/SshModule';

type Params = Omit<ConnectOptions, 'cols' | 'rows'>;

/** Pantalla provisional: conexión rápida. Se sustituirá por la lista de hosts. */
export function ConnectScreen({ onConnect }: { onConnect(p: Params): void }) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');

  const ok = host.trim() && user.trim() && Number(port) > 0;

  return (
    <SafeAreaView style={styles.root}>
      <Text style={styles.h1}>LuloSSH</Text>
      <Field label="Host" value={host} onChange={setHost} />
      <Field
        label="Puerto"
        value={port}
        onChange={setPort}
        keyboardType="number-pad"
      />
      <Field label="Usuario" value={user} onChange={setUser} />
      <Field
        label="Contraseña"
        value={password}
        onChange={setPassword}
        secure
      />
      <Pressable
        disabled={!ok}
        style={[styles.btn, !ok && { opacity: 0.4 }]}
        onPress={() =>
          onConnect({
            host: host.trim(),
            port: Number(port),
            username: user.trim(),
            auth: { type: 'password', password },
          })
        }
      >
        <Text style={styles.btnText}>Conectar</Text>
      </Pressable>
    </SafeAreaView>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange(v: string): void;
  secure?: boolean;
  keyboardType?: 'number-pad';
}) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        style={styles.input}
        value={props.value}
        onChangeText={props.onChange}
        secureTextEntry={props.secure}
        keyboardType={props.keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor="#5b6b7c"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0f14', padding: 20 },
  h1: { color: '#fff', fontSize: 28, fontWeight: '700', marginBottom: 20 },
  label: { color: '#8fa1b3', marginBottom: 4 },
  input: {
    backgroundColor: '#161c24',
    color: '#d7dde5',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  btn: {
    backgroundColor: '#3b82f6',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  btnText: { color: '#fff', fontWeight: '700' },
});
