import type { ImageMetadata } from 'astro';
import opisy from '../data/zdjecia.json';

/** Zdjęcie główne strony głównej i domyślne zdjęcie do udostępnień. */
export const ZDJECIE_GLOWNE = 'glowna.webp';

// Import zachłanny (`eager: true`): WSZYSTKIE pliki z src/assets/zdjecia trafiają do dist/_astro, także zdjęcia wpisów
// zaplanowanych na przyszłość, które nie występują jeszcze w żadnym HTML. Ich adresy są przez to publiczne przed datą wpisu.
const moduly = import.meta.glob<{ default: ImageMetadata }>('../assets/zdjecia/*.webp', { eager: true });
const wgNazwy = new Map<string, ImageMetadata>(
  Object.entries(moduly).map(([sciezka, m]) => [sciezka.split('/').pop()!, m.default]),
);

export function zdjecie(nazwa: string): ImageMetadata {
  const obraz = wgNazwy.get(nazwa.split('/').pop() ?? '');
  if (!obraz) throw new Error(`Brak zdjęcia „${nazwa}” w src/assets/zdjecia/`);
  return obraz;
}

export function altZdjecia(nazwa: string): string {
  return (opisy as Record<string, string>)[nazwa.split('/').pop() ?? ''] ?? '';
}
