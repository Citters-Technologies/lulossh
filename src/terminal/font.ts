/** Fuente de la consola. 'nerd' = JetBrains Mono Nerd Font (iconos/powerline). */
export const TERM_FONT_PREF = 'terminalFont';
export const DEFAULT_FONT = 'nerd';

export interface FontOption {
  id: string;
  name: string;
  sub: string;
}

export const TERM_FONTS: FontOption[] = [
  {
    id: 'nerd',
    name: 'JetBrains Mono (Nerd Font)',
    sub: 'Incluye iconos y glifos powerline (starship, p10k…)',
  },
  {
    id: 'system',
    name: 'Fuente del sistema',
    sub: 'La monoespaciada por defecto del móvil',
  },
];

export const fontName = (id?: string | null): string =>
  (TERM_FONTS.find(f => f.id === id) ?? TERM_FONTS[0]).name;
