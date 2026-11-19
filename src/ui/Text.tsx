import React from 'react';
import { Platform, Text as RNText, TextProps } from 'react-native';

/**
 * Fuente de la interfaz en Android. Algunos fabricantes (p. ej. Lenovo ZUI)
 * cambian la fuente del sistema y React Native mide los textos con una y los
 * dibuja con otra: se come la última letra o la última palabra. Fijando la
 * familia, medida y dibujo usan la misma.
 */
export const UI_FONT = Platform.select<string | undefined>({
  android: 'sans-serif',
  default: undefined,
});

const base = UI_FONT ? { fontFamily: UI_FONT } : undefined;

/** Text de React Native con la fuente de la app. Úsalo en lugar del original. */
export function Text({ style, ...rest }: TextProps) {
  return <RNText {...rest} style={base ? [base, style] : style} />;
}
