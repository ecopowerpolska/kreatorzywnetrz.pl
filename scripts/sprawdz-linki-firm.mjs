#!/usr/bin/env node
// sprawdz-linki-firm.mjs: bramka linków do firm (uruchamia npm run guard:build; argument = katalog dist).
// Reguła Piotra 2026-11-06: do firmy prowadzi JEDNO zwykłe słowo w zdaniu wpisu, najwyżej jeden link na witrynę w całym blogu.
// Blokady (dist/ i źródła wszystkich wpisów, także zaplanowanych):
//   1) link do firmy tylko w treści wpisu (<div class="tresc">), bez rel, w pierwszej połowie tekstu, najwyżej 1 na wpis;
//   2) każda witryna firmy najwyżej 1 link w całym dist/ i najwyżej 1 w src/content/wpisy/;
//   3) anchor = jedno słowo, bez nazwy firmy;
//   4) zero nazw firm, „polecamy” i fraz o wydawcy poza polityką prywatności (adresy linków nie są liczone jako nazwa).
// Ostrzeżenie (bez blokady): wpisy z linkiem do firm mają być w mniejszości opublikowanych wpisów.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';

const DOMENA = /^https?:\/\/(?:[a-z0-9-]+\.)?(studioagat\.pl|nadihome\.pl|pan-stolarz\.pl)(?:[/?#]|$)/i;
const ADRES_FIRMY = /https?:\/\/(?:[a-z0-9-]+\.)?(?:studioagat|nadihome|pan-stolarz)\.pl[^\s"'<>)]*/gi;
// Wyrażenia zapisane klasami znaków, żeby sam ten plik nie zawierał szukanych słów dosłownie.
const NAZWY = [/studio[\s_-]*ag[a]t/i, /nadi[\s_-]*h[o]me/i, /pan[\s_-]*stol[a]rz/i, /polec[a]m/i];
const FRAZY_WYDAWCA = [
  /eco[\s_-]?power/i,
  /api\.eco/i,
  /(?<!\p{L})sp[oó][lł]k(?:a|i|ę|ą|o|ach|ami|om|ek)(?!\p{L})/iu,
  /sp\.\s?z\s?o\.\s?o\./i,
  /wydaje t[eę] stron[eę]/i,
  /wydaj[aą]c[aey] t[eę] stron[eę]/i,
  /stron[eę] wydaje/i,
  /wydawc[aąęy] (?:strony|magazynu|serwisu)/i,
  /ta sama firma/i,
  /parentOrganization/,
];
const JEDNO_SLOWO = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)?$/u;

const DIST = join(process.cwd(), process.argv[2] ?? 'dist');
const WPISY = join(process.cwd(), 'src/content/wpisy');
const bledy = [];
const ostrzezenia = [];

if (!existsSync(DIST)) {
  console.error(`Brak katalogu ${DIST}: najpierw astro build.`);
  process.exit(1);
}

const pliki = (d, rozszerzenia) =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? pliki(join(d, e.name), rozszerzenia) : rozszerzenia.some((r) => e.name.endsWith(r)) ? [join(d, e.name)] : [],
  );
const bezZnacznikow = (s) => s.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const domena = (href) => href.match(DOMENA)?.[1].toLowerCase();
const sprawdzAnchor = (gdzie, anchor) => {
  if (!JEDNO_SLOWO.test(anchor)) bledy.push(`${gdzie}: anchor linku do firmy "${anchor}" (ma być jedno zwykłe słowo)`);
  for (const n of NAZWY) if (n.test(anchor)) bledy.push(`${gdzie}: anchor linku do firmy "${anchor}" zawiera nazwę firmy albo „polecamy”`);
};

// ── dist/: HTML ──
const wDist = new Map();
let wpisow = 0;
let wpisowZLinkiem = 0;
for (const plik of pliki(DIST, ['.html'])) {
  const html = readFileSync(plik, 'utf8');
  const tresc = html.match(/<div class="tresc">[\s\S]*?<\/article>/)?.[0] ?? '';
  if (/<article class="wpis[ "]/.test(html)) wpisow++;
  const linki = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)]
    .map((m) => ({ a: m[1], href: m[1].match(/href="([^"]+)"/)?.[1] ?? '', anchor: bezZnacznikow(m[2]), poz: m.index }))
    .filter((l) => domena(l.href));
  const odTresci = tresc ? html.indexOf(tresc) : -1;
  const wTresci = linki.filter((l) => odTresci >= 0 && l.poz >= odTresci && l.poz < odTresci + tresc.length);
  for (const l of linki) {
    const d = domena(l.href);
    wDist.set(d, [...(wDist.get(d) ?? []), `${plik.slice(DIST.length)} „${l.anchor}”`]);
    if (!wTresci.includes(l)) bledy.push(`${plik}: link do firmy poza treścią wpisu (${l.href})`);
  }
  if (wTresci.length) wpisowZLinkiem++;
  if (wTresci.length > 1) bledy.push(`${plik}: ${wTresci.length} linków do firm w treści wpisu (dozwolony 1)`);
  const dlugosc = bezZnacznikow(tresc).length;
  for (const l of wTresci) {
    if (/\brel\s*=/.test(l.a)) bledy.push(`${plik}: link do firmy z rel (${l.href}), w treści ma być bez rel`);
    sprawdzAnchor(plik, l.anchor);
    const przed = bezZnacznikow(html.slice(odTresci, l.poz)).length;
    if (dlugosc && przed / dlugosc > 0.5) bledy.push(`${plik}: link do firmy w drugiej połowie tekstu (${Math.round((100 * przed) / dlugosc)} %), ma być w pierwszej`);
  }
}
for (const [d, gdzie] of wDist) if (gdzie.length > 1) bledy.push(`dist: ${gdzie.length} linki do ${d} (dozwolony 1 na witrynę): ${gdzie.join('; ')}`);
if (wpisowZLinkiem && wpisowZLinkiem * 2 >= wpisow) ostrzezenia.push(`wpisy z linkiem do firm: ${wpisowZLinkiem} z ${wpisow}, mają być w mniejszości`);

// ── src/content/wpisy/: wszystkie wpisy, także zaplanowane ──
const wZrodle = new Map();
if (existsSync(WPISY)) {
  for (const plik of pliki(WPISY, ['.md', '.mdx'])) {
    const md = readFileSync(plik, 'utf8');
    for (const m of md.matchAll(/\[([^\]]*)\]\(([^)\s]+)[^)]*\)|<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const href = m[2] ?? m[3];
      const d = domena(href);
      if (!d) continue;
      wZrodle.set(d, [...(wZrodle.get(d) ?? []), plik.slice(WPISY.length + 1)]);
      sprawdzAnchor(plik, bezZnacznikow(m[1] ?? m[4]).trim());
    }
    const bezAdresow = md.replace(ADRES_FIRMY, ' ');
    for (const f of [...NAZWY, ...FRAZY_WYDAWCA]) {
      const t = bezAdresow.match(f);
      if (t) bledy.push(`${plik}: fraza "${t[0]}" (nazwa firmy, „polecamy” albo wydawca; blokada)`);
    }
  }
}
for (const [d, gdzie] of wZrodle) if (gdzie.length > 1) bledy.push(`src/content/wpisy: ${gdzie.length} linki do ${d} (dozwolony 1 na witrynę w całym blogu): ${gdzie.join(', ')}`);

// ── dist/: nazwy firm, „polecamy” i frazy o wydawcy (poza polityką prywatności, która zostaje w całości) ──
const doSkanu = pliki(DIST, ['.html', '.txt', '.xml', '.json', '.webmanifest']).filter((p) => !p.includes(`${sep}polityka-prywatnosci${sep}`));
for (const plik of doSkanu) {
  const tekst = readFileSync(plik, 'utf8').replace(ADRES_FIRMY, ' ');
  for (const f of [...NAZWY, ...FRAZY_WYDAWCA]) {
    const m = tekst.match(f);
    if (m) bledy.push(`${plik}: fraza "${m[0]}" (nazwa firmy, „polecamy” albo wydawca; blokada)`);
  }
}

for (const o of ostrzezenia) console.warn(`OSTRZEŻENIE: ${o}`);
if (bledy.length) {
  console.error(bledy.join('\n'));
  process.exit(1);
}
const lista = (m) => [...m].map(([d, g]) => `${d} ${g.length}`).join(', ') || 'brak';
console.log(
  `Linki do firm: zgodne z regułą (dist: ${lista(wDist)}; źródła wpisów: ${lista(wZrodle)}; plików ${doSkanu.length}, wpisów ${wpisow}, z linkiem ${wpisowZLinkiem}).`,
);
