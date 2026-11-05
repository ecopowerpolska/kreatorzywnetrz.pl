import teksty from '../data/teksty.json';

/** Wartość z teksty.json po ścieżce z kropkami (np. 'glowna.h1'); brak = klucz zastępczy, by build nie padł. */
export function t(sciezka: string, domyslny?: string): string {
  const w = pobierz(sciezka);
  return typeof w === 'string' && w.trim() !== '' ? w : (domyslny ?? `[brak: ${sciezka}]`);
}

/** Lista tekstów po ścieżce (akapity); brak = pusta lista. */
export function lista(sciezka: string): string[] {
  const w = pobierz(sciezka);
  return Array.isArray(w) ? w.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];
}

/** Dowolna wartość po ścieżce (obiekty i tablice sekcji). */
export function pobierz(sciezka: string): unknown {
  let w: unknown = teksty;
  for (const k of sciezka.split('.')) {
    if (w && typeof w === 'object' && k in (w as Record<string, unknown>)) w = (w as Record<string, unknown>)[k];
    else return undefined;
  }
  return w;
}

/** Szablon „{zrodlo}” → wartość. */
export function wstaw(szablon: string, wartosci: Record<string, string>): string {
  return Object.entries(wartosci).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), szablon);
}

/** Odnośnik w tekście: [kotwica](/trasa/) albo [kotwica](https://…) → kawałki. Tylko adresy od „/” i https:// (bez javascript: i http:). */
export type Kawalek = { tekst: string; adres?: string };
export function kawalki(t: string): Kawalek[] {
  const wynik: Kawalek[] = [];
  let od = 0;
  for (const m of t.matchAll(/\[([^\]]+)\]\((\/[^)\s]*|https:\/\/[^)\s]+)\)/g)) {
    if (m.index! > od) wynik.push({ tekst: t.slice(od, m.index) });
    wynik.push({ tekst: m[1], adres: m[2] });
    od = m.index! + m[0].length;
  }
  if (od < t.length) wynik.push({ tekst: t.slice(od) });
  return wynik;
}
