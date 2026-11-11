import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  KeyboardLayout,
  KeyButton,
  Modifier,
  ModifierState,
  resolveAction,
} from './model';

interface Props {
  layout: KeyboardLayout;
  /** Modificadores pegajosos pendientes (se consumen con la siguiente tecla). */
  mods: ModifierState;
  onToggleModifier(m: Modifier): void;
  /** Bytes a enviar al PTY. */
  onSend(data: string): void;
}

const REPEAT_DELAY = 400;
const REPEAT_INTERVAL = 60;

export function KeyBar({ layout, mods, onToggleModifier, onSend }: Props) {
  const [layerName, setLayerName] = useState(layout.defaultLayer);
  const layer = layout.layers[layerName] ?? layout.layers[layout.defaultLayer];

  const timers = useRef<{
    t?: ReturnType<typeof setTimeout>;
    i?: ReturnType<typeof setInterval>;
  }>({});
  const stopRepeat = useCallback(() => {
    clearTimeout(timers.current.t);
    clearInterval(timers.current.i);
  }, []);
  useEffect(() => stopRepeat, [stopRepeat]);

  // Ref para que el repeat siempre use los modificadores actuales.
  const modsRef = useRef(mods);
  modsRef.current = mods;

  const fire = (btn: KeyButton) => {
    const a = btn.action;
    if (a.kind === 'modifier') {
      onToggleModifier(a.modifier);
    } else if (a.kind === 'layer') {
      setLayerName(a.layer);
    } else {
      const out = resolveAction(a, modsRef.current);
      if (out) {
        onSend(out);
      }
    }
  };

  const pressIn = (btn: KeyButton) => {
    fire(btn);
    if (btn.repeat) {
      timers.current.t = setTimeout(() => {
        timers.current.i = setInterval(() => fire(btn), REPEAT_INTERVAL);
      }, REPEAT_DELAY);
    }
  };

  const isActive = (btn: KeyButton) =>
    btn.action.kind === 'modifier' && mods[btn.action.modifier];

  return (
    <View style={styles.bar}>
      {layer.rows.map((row, r) => (
        <View key={r} style={styles.row}>
          {row.map(btn => (
            <Pressable
              key={btn.id}
              onPressIn={() => pressIn(btn)}
              onPressOut={stopRepeat}
              style={({ pressed }) => [
                styles.key,
                isActive(btn) && styles.keyActive,
                pressed && styles.keyPressed,
              ]}
              accessibilityLabel={btn.label}
            >
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
                style={[styles.label, isActive(btn) && styles.labelActive]}
              >
                {btn.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: '#161c24', paddingVertical: 4, paddingHorizontal: 2 },
  row: { flexDirection: 'row' },
  key: {
    flex: 1,
    minHeight: 40,
    margin: 2,
    borderRadius: 6,
    backgroundColor: '#242d38',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyActive: { backgroundColor: '#3b82f6' },
  keyPressed: { backgroundColor: '#35414f' },
  label: { color: '#d7dde5', fontSize: 14, paddingHorizontal: 2 },
  labelActive: { color: '#fff', fontWeight: '700' },
});
