// Zapowiedzi z RSS (kolekcja `polecane`, pliki pisze scripts/agreguj-rss.mjs).
// Data zapowiedzi = data oryginału na stronie źródłowej; zapowiedzi stoją poza chronologią własnych wpisów.
import { getCollection, type CollectionEntry } from 'astro:content';

export type Polecany = CollectionEntry<'polecane'>;

/** Najwyżej tyle zapowiedzi z jednego źródła na danej stronie. */
export const NA_ZRODLO_GLOWNA = 1;
export const NA_ZRODLO_POLECAMY = 3;
export const NA_ZRODLO_LLMS = 3;
/** Zapowiedź starsza niż tyle dni nie wchodzi na listy. */
export const DNI_POLECANYCH = 90;

const DZIEN_MS = 86_400_000;

/** Od najnowszej; remis dat rozstrzyga id, żeby kolejność nie zależała od loadera. */
const odNajnowszej = (a: Polecany, b: Polecany) => b.data.data.getTime() - a.data.data.getTime() || a.id.localeCompare(b.id);

/** Wszystkie zapowiedzi, od najnowszej. */
export async function wszystkiePolecane(): Promise<Polecany[]> {
  return (await getCollection('polecane')).sort(odNajnowszej);
}

/**
 * Zapowiedzi z różnych źródeł: najwyżej `naZrodlo` z jednej firmy, nie starsze niż `dni`, od najnowszej.
 * Funkcja czysta (nie zmienia `wszystkie`), `teraz` do testów.
 */
export function polecaneRozne(wszystkie: Polecany[], naZrodlo: number, dni = DNI_POLECANYCH, teraz = Date.now()): Polecany[] {
  const granica = teraz - dni * DZIEN_MS;
  const licznik = new Map<string, number>();
  const wynik: Polecany[] = [];
  for (const w of [...wszystkie].sort(odNajnowszej)) {
    if (w.data.data.getTime() < granica) continue;
    const n = licznik.get(w.data.zrodlo) ?? 0;
    if (n >= naZrodlo) continue;
    licznik.set(w.data.zrodlo, n + 1);
    wynik.push(w);
  }
  return wynik;
}
