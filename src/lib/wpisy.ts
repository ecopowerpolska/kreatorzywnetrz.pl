import { getCollection, type CollectionEntry } from 'astro:content';
import type { Dzial } from './dzialy';

export type Wpis = CollectionEntry<'wpisy'>;

/**
 * Wpisy opublikowane, od najnowszego. Wpis z datą w przyszłości czeka: przebudowa w Actions (trzy razy dziennie: 03:17, 07:47
 * i 11:23 UTC) wypuszcza go w dniu daty. Liczba oczekujących idzie do logu budowania.
 */
export async function opublikowane(): Promise<Wpis[]> {
  const wszystkie = await getCollection('wpisy');
  const teraz = Date.now();
  const gotowe = wszystkie.filter((w) => w.data.data.getTime() <= teraz);
  if (gotowe.length < wszystkie.length) {
    console.info(`[wpisy] oczekuje na datę publikacji: ${wszystkie.length - gotowe.length}`);
  }
  // Remis dat (kilka wpisów z tego samego dnia) rozstrzyga id, żeby kolejność nie zależała od loadera.
  return gotowe.sort((a, b) => b.data.data.getTime() - a.data.data.getTime() || a.id.localeCompare(b.id));
}

/** Rozdziały H2 wpisu do spisu treści (z wyniku render()). */
export const rozdzialy = (naglowki: { depth: number; slug: string; text: string }[]) => naglowki.filter((n) => n.depth === 2);

/** Opublikowane wpisy jednego działu, od najnowszego. */
export async function zDzialu(dzial: Dzial): Promise<Wpis[]> {
  return (await opublikowane()).filter((w) => w.data.dzial === dzial);
}

/**
 * „Więcej z działu”: najnowsze inne wpisy tego działu; gdy działowi brakuje do kompletu, dobiera najnowsze z całej strony.
 * `wszystkie` = wynik opublikowane().
 */
export function wiecejZDzialu(wpis: Wpis, wszystkie: Wpis[], ile = 3): Wpis[] {
  const inne = wszystkie.filter((w) => w.id !== wpis.id);
  const zDzialu = inne.filter((w) => w.data.dzial === wpis.data.dzial).slice(0, ile);
  if (zDzialu.length >= 2 || zDzialu.length === inne.length) return zDzialu;
  const dobrane = inne.filter((w) => !zDzialu.includes(w)).slice(0, ile - zDzialu.length);
  return [...zDzialu, ...dobrane];
}

/** Czas czytania w minutach: słowa treści ÷ 200, w górę, najmniej 1. Liczone z surowego Markdownu bez znaczników. */
export function czasCzytania(wpis: Wpis): number {
  const tekst = (wpis.body ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[#>*_`|~]+/g, ' ');
  const slowa = tekst.split(/\s+/).filter((s) => /[\p{L}\p{N}]/u.test(s)).length;
  return Math.max(1, Math.ceil(slowa / 200));
}

export const adresWpisu = (id: string) => `/blog/${id}/`;

const FORMAT = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Warsaw' });
export const dataPoPolsku = (d: Date) => FORMAT.format(d);
export const dataIso = (d: Date) => d.toISOString().slice(0, 10);

/** Tekst bez znaczników HTML i nadmiarowych spacji. */
export const bezHtml = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
