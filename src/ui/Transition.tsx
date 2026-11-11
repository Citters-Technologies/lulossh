import React, { useLayoutEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';

export type Direction = 'forward' | 'back' | 'fade';

/**
 * Transición de pantalla ligera (driver nativo): al entrar, la nueva llega
 * desde la derecha; al volver, desde la izquierda; entre pestañas, fundido.
 */
export function Transition({
  routeKey,
  direction,
  children,
}: {
  /** Cambia cuando cambia la pantalla. */
  routeKey: string;
  direction: Direction;
  children: React.ReactNode;
}) {
  const progress = useRef(new Animated.Value(1)).current;
  const dir = useRef<Direction>(direction);
  const lastKey = useRef(routeKey);
  if (lastKey.current !== routeKey) {
    // En el mismo render del cambio, para interpolar con la dirección nueva.
    lastKey.current = routeKey;
    dir.current = direction;
  }
  const first = useRef(true);

  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return; // sin animación al arrancar
    }
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: direction === 'fade' ? 220 : 340,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1), // desacelera suave, sin rebote
      useNativeDriver: true,
    }).start();
    // Solo al cambiar de pantalla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  const offset = dir.current === 'forward' ? 72 : dir.current === 'back' ? -72 : 0;
  // Empezar casi opaco: partir de transparente sobre fondo negro da "flashazo".
  const style = {
    opacity: progress.interpolate({
      inputRange: [0, 1],
      outputRange: [dir.current === 'fade' ? 0.75 : 0.85, 1],
    }),
    transform: [
      {
        translateX: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [offset, 0],
        }),
      },
    ],
  };

  return <Animated.View style={[styles.fill, style]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
