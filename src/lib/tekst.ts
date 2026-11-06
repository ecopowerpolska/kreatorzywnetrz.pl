import teksty from '../data/teksty.json';

// Brak klucza w teksty.json = błąd budowania z nazwą klucza (nie zaślepka na stronie).
const brak = (sciezka: string, co: string): never => {
  throw new Error(`teksty.json: ${co} pod kluczem „${sciezka}”`);
};

/** Tekst po ścieżce z kropkami (np. 'glowna.tytul'); brak albo pusty = błąd budowania. */
export function t(sciezka: string): string {
  const w = pobierz(sciezka);
  if (typeof w !== 'string') return brak(sciezka, 'brak tekstu');
  if (w.trim() === '') return brak(sciezka, 'pusty tekst');
  return w;
}

/** Lista tekstów po ścieżce (akapity); brak albo nie-lista = błąd budowania. */
export function lista(sciezka: string): string[] {
  const w = pobierz(sciezka);
  if (!Array.isArray(w)) return brak(sciezka, 'brak listy');
  return w.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
}

/** Lista obiektów po ścieżce (menu, firmy, sekcje); brak = błąd budowania. */
export function obiekty(sciezka: string): Record<string, unknown>[] {
  const w = pobierz(sciezka);
  if (!Array.isArray(w)) return brak(sciezka, 'brak listy obiektów');
  return w.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');
}

/** Pole tekstowe obiektu z listy; brak = błąd budowania z pełną ścieżką. */
export function pole(obiekt: Record<string, unknown>, nazwa: string, sciezka: string): string {
  const w = obiekt[nazwa];
  if (typeof w !== 'string' || w.trim() === '') return brak(`${sciezka}.${nazwa}`, 'brak tekstu');
  return w.trim();
}

/** Dowolna wartość po ścieżce (bez kontroli). */
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

