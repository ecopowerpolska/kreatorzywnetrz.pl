#!/usr/bin/env node
// agreguj-rss.mjs — agregator zapowiedzi z naszych stron (Node 22+, bez zależności).
//
// Czyta kanały RSS z src/data/zrodla-rss.json i dla każdego NOWEGO wpisu zapisuje plik
// src/content/polecane/<slug-źródła>-<hash8 linku>.md: tytuł, 2–4 zdania opisu (max 400 znaków, bez HTML),
// data, źródło, link do oryginału i — jeśli kanał go podaje — adres zdjęcia. PEŁNEJ TREŚCI nigdy nie kopiuje.
// Kluczem wpisu jest link: istniejący plik jest pomijany (nigdy nie nadpisujemy). Błąd jednego źródła
// nie przerywa pozostałych. Kod wyjścia 0 także przy błędach źródeł (to nie jest błąd budowania strony);
// w Actions błędy idą jako ostrzeżenia ::warning::.
//
// Użycie:  npm run agreguj            — zapis plików
//          node scripts/agreguj-rss.mjs --sucho   — tylko raport, bez zapisu

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const KORZEN = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ZRODLA = join(KORZEN, 'src/data/zrodla-rss.json');
const CEL = join(KORZEN, 'src/content/polecane');
const SUCHO = process.argv.includes('--sucho');
const MAKS_NA_ZRODLO = 30; // najnowsze wpisy kanału, które bierzemy pod uwagę
const MAKS_OPIS = 400;
const MAKS_ZDAN = 4;
const LIMIT_CZASU_MS = 20_000;
const W_ACTIONS = process.env.GITHUB_ACTIONS === 'true';

const ENCJE = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—', laquo: '«', raquo: '»', bdquo: '„', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’' };

/** Dekoduje encje HTML/XML (nazwane i liczbowe). Jeden przebieg: &amp;lt; zostaje „&lt;”. */
function dekoduj(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (calosc, k) => {
    if (k[0] === '#') {
      const kod = k[1].toLowerCase() === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      try {
        return String.fromCodePoint(kod);
      } catch {
        return calosc;
      }
    }
    return ENCJE[k.toLowerCase()] ?? calosc;
  });
}

/** Zawartość pierwszego znacznika o danej nazwie (z prefiksem przestrzeni nazw), z obsługą CDATA. */
function znacznik(blok, nazwa) {
  const m = blok.match(new RegExp(`<${nazwa}(?:\\s[^>]*)?>([\\s\\S]*?)</${nazwa}>`, 'i'));
  if (!m) return '';
  const cdata = m[1].match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return cdata ? cdata[1] : dekoduj(m[1]);
}

/** Wartość atrybutu z pierwszego znacznika o danej nazwie (np. enclosure url). */
function atrybut(blok, nazwa, atr, warunek = () => true) {
  for (const m of blok.matchAll(new RegExp(`<${nazwa}\\b([^>]*)>`, 'gi'))) {
    const w = m[1].match(new RegExp(`\\b${atr}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
    if (w && warunek(m[1])) return dekoduj(w[2] ?? w[3] ?? '');
  }
  return '';
}

const bezHtml = (s) =>
  dekoduj(
    s
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/(p|div|li|h[1-6]|br)>|<br\s*\/?>/gi, ' ')
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();

/** 2–4 pierwsze zdania, razem do MAKS_OPIS znaków; jedno za długie zdanie jest ucinane na granicy słowa. */
function skrot(tekst) {
  const zdania = tekst.split(/(?<=[.!?…])\s+(?=[A-ZĄĆĘŁŃÓŚŹŻ0-9„"“(])/);
  let wynik = '';
  let ile = 0;
  for (const z of zdania) {
    const kandydat = wynik ? `${wynik} ${z}` : z;
    if (kandydat.length > MAKS_OPIS || ile >= MAKS_ZDAN) break;
    wynik = kandydat;
    ile++;
  }
  if (wynik) return wynik;
  if (tekst.length <= MAKS_OPIS) return tekst;
  const ciety = tekst.slice(0, MAKS_OPIS - 1);
  return `${ciety.slice(0, ciety.lastIndexOf(' ') > 200 ? ciety.lastIndexOf(' ') : ciety.length).replace(/[\s,;:.–-]+$/, '')}…`;
}

const slug = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const host = (adres) => new URL(adres).hostname.replace(/^www\./, '');

function poprawnyAdres(kandydat, baza) {
  try {
    const u = new URL(kandydat.trim(), baza);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
  } catch {
    return '';
  }
}

/** Wyciąga pozycje z RSS 2.0 (<item>) albo Atom (<entry>). */
function pozycje(xml, adresKanalu) {
  const bloki = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => m[2]);
  return bloki.map((b) => {
    const link = poprawnyAdres(
      znacznik(b, 'link').trim() || atrybut(b, 'link', 'href', (a) => !/rel\s*=\s*["']?(?!alternate)/i.test(a)) || znacznik(b, 'guid').trim(),
      adresKanalu,
    );
    const opisSurowy = znacznik(b, 'description') || znacznik(b, 'summary');
    const tresc = znacznik(b, 'content:encoded') || znacznik(b, 'content');
    const html = opisSurowy || tresc;
    const zdjecie =
      atrybut(b, 'enclosure', 'url', (a) => /type\s*=\s*["']image\//i.test(a)) ||
      atrybut(b, 'media:content', 'url', (a) => !/type\s*=\s*["'](?!image)/i.test(a) && !/medium\s*=\s*["']video/i.test(a)) ||
      atrybut(b, 'media:thumbnail', 'url') ||
      (dekoduj(tresc || html).match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i) ?? [])[1] ||
      '';
    const dataTekst = (znacznik(b, 'pubDate') || znacznik(b, 'published') || znacznik(b, 'updated') || znacznik(b, 'dc:date')).trim();
    const data = new Date(dataTekst);
    return {
      link,
      tytul: bezHtml(znacznik(b, 'title')).replace(/\s*[—–]\s*/g, ': '),
      opis: skrot(bezHtml(html)),
      zdjecie: zdjecie ? poprawnyAdres(zdjecie, link || adresKanalu) : '',
      data: Number.isNaN(data.getTime()) ? null : data,
    };
  });
}

const plikWpisu = (zrodlo, p) => {
  const hash = createHash('sha1').update(p.link).digest('hex').slice(0, 8);
  return join(CEL, `${slug(zrodlo)}-${hash}.md`);
};

function tresc(zrodlo, p) {
  const pola = [
    `tytul: ${JSON.stringify(p.tytul)}`,
    `opis: ${JSON.stringify(p.opis)}`,
    `data: ${JSON.stringify((p.data ?? new Date()).toISOString())}`,
    `zrodlo: ${JSON.stringify(zrodlo)}`,
    `link: ${JSON.stringify(p.link)}`,
  ];
  if (p.zdjecie.startsWith('https://')) pola.push(`zdjecie: ${JSON.stringify(p.zdjecie)}`);
  return `---\n${pola.join('\n')}\n---\n`;
}

async function pobierz(adres) {
  const odpowiedz = await fetch(adres, {
    redirect: 'follow',
    signal: AbortSignal.timeout(LIMIT_CZASU_MS),
    headers: {
      'User-Agent': 'KreatorzyWnetrz-agregator/1.0 (+https://kreatorzywnetrz.pl)',
      Accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
    },
  });
  if (!odpowiedz.ok) throw new Error(`HTTP ${odpowiedz.status}`);
  return odpowiedz.text();
}

async function main() {
  const zrodla = JSON.parse(readFileSync(ZRODLA, 'utf8'));
  if (!SUCHO) mkdirSync(CEL, { recursive: true });
  const raport = [];

  for (const z of zrodla) {
    const wiersz = { zrodlo: z.nazwa, nowych: 0, pominietych: 0, odrzuconych: 0, blad: '' };
    raport.push(wiersz);
    try {
      const xml = await pobierz(z.adres);
      if (!/<(rss|feed)\b/i.test(xml)) throw new Error('odpowiedź nie jest kanałem RSS/Atom');
      const wszystkie = pozycje(xml, z.adres);
      const wlasne = host(z.adres);
      const najnowsze = wszystkie
        .filter((p) => p.link && p.tytul)
        .sort((a, b) => (b.data?.getTime() ?? 0) - (a.data?.getTime() ?? 0))
        .slice(0, MAKS_NA_ZRODLO);
      wiersz.odrzuconych += wszystkie.length - wszystkie.filter((p) => p.link && p.tytul).length;
      for (const p of najnowsze) {
        // Zapowiedź musi prowadzić do tej samej witryny co kanał (nie linkujemy dalej, niż wskazuje źródło).
        if (host(p.link) !== wlasne) {
          wiersz.odrzuconych++;
          continue;
        }
        const plik = plikWpisu(z.nazwa, p);
        if (existsSync(plik)) {
          wiersz.pominietych++;
          continue;
        }
        if (!SUCHO) writeFileSync(plik, tresc(z.nazwa, p));
        wiersz.nowych++;
      }
    } catch (e) {
      wiersz.blad = e?.name === 'TimeoutError' ? `przekroczono ${LIMIT_CZASU_MS / 1000} s` : String(e?.message ?? e);
      if (W_ACTIONS) console.log(`::warning title=Agregacja RSS::źródło ${z.nazwa} (${z.adres}): ${wiersz.blad}`);
    }
  }

  const suma = (k) => raport.reduce((s, w) => s + w[k], 0);
  console.log(`Agregacja RSS${SUCHO ? ' (na sucho, bez zapisu)' : ''}:`);
  for (const w of raport) {
    console.log(
      w.blad
        ? `  BŁĄD  ${w.zrodlo}: ${w.blad}`
        : `  ok    ${w.zrodlo}: nowych ${w.nowych}, pominiętych ${w.pominietych}, odrzuconych ${w.odrzuconych}`,
    );
  }
  const padle = raport.filter((w) => w.blad).map((w) => w.zrodlo);
  console.log(
    `Razem: nowych ${suma('nowych')}, pominiętych ${suma('pominietych')}, odrzuconych ${suma('odrzuconych')}; źródła z błędem: ${padle.length ? padle.join(', ') : 'brak'}.`,
  );
}

main().catch((e) => {
  console.error('Agregator zatrzymał się z błędem własnym:', e);
  process.exit(1);
});
