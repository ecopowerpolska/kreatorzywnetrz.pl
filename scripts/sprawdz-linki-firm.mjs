#!/usr/bin/env node
// sprawdz-linki-firm.mjs: bramka linków do polecanych firm w dist/ (uruchamia npm run guard:build).
// 1) w treści wpisu (<article class="wpis...">) najwyżej 1 link do firm, bez rel, w pierwszej połowie tekstu, anchor = sama marka;
// 2) poza treścią wpisu każdy link do firm ma rel="nofollow"; 3) w nagłówku, menu i stopce nie ma żadnego;
// 4) blokada: w dist/ (HTML, txt, xml, json; poza polityka-prywatnosci/) nie ma fraz o wydawcy strony.
// Ostrzeżenie (bez blokady): wpisy z linkiem do firm mają być w mniejszości opublikowanych wpisów.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';

const FIRMY = /^https?:\/\/(?:[a-z0-9-]+\.)?(studioagat\.pl|nadihome\.pl|pan-stolarz\.pl)(?:[/?#]|$)/i;
const MARKI = new Set(['Studio Agat', 'Nadi Home', 'Pan Stolarz']);
const DIST = join(process.cwd(), process.argv[2] ?? 'dist');
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
const linki = (s) =>
  [...s.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)]
    .map((m) => ({ a: m[1], href: m[1].match(/href="([^"]+)"/)?.[1] ?? '', anchor: bezZnacznikow(m[2]), poz: m.index }))
    .filter((l) => FIRMY.test(l.href));

let wpisow = 0;
let wpisowZLinkiem = 0;
for (const plik of pliki(DIST, ['.html'])) {
  const html = readFileSync(plik, 'utf8');
  const wpis = html.match(/<article class="wpis[ "][^>]*>[\s\S]*?<\/article>/)?.[0] ?? '';
  const poza = wpis ? html.replace(wpis, '') : html;
  if (wpis) wpisow++;
  const wTresci = linki(wpis);
  if (wTresci.length) wpisowZLinkiem++;
  if (wTresci.length > 1) bledy.push(`${plik}: ${wTresci.length} linków do firm w treści wpisu (dozwolony 1)`);
  // Połowę tekstu liczymy od bloku treści (<div class="tresc">), bez tytułu i metryczki; brak bloku = cały artykuł.
  const odTresci = Math.max(0, wpis.indexOf('class="tresc"'));
  const dlugosc = bezZnacznikow(wpis.slice(odTresci)).length;
  for (const l of wTresci) {
    if (/\brel\s*=/.test(l.a)) bledy.push(`${plik}: link w treści wpisu z rel (${l.href}), ma być bez rel`);
    if (!MARKI.has(l.anchor)) bledy.push(`${plik}: anchor linku do firmy "${l.anchor}" (ma być sama marka: ${[...MARKI].join(', ')})`);
    const przed = bezZnacznikow(wpis.slice(odTresci, Math.max(odTresci, l.poz))).length;
    if (dlugosc && przed / dlugosc > 0.5) bledy.push(`${plik}: link do firmy w drugiej połowie tekstu (${Math.round((100 * przed) / dlugosc)} %), ma być w pierwszej`);
  }
  for (const l of linki(poza)) if (!/\brel="[^"]*\bnofollow\b/.test(l.a)) bledy.push(`${plik}: link do firmy poza treścią wpisu bez nofollow (${l.href})`);
  for (const blok of poza.match(/<(header|footer|nav)\b[\s\S]*?<\/\1>/g) ?? []) {
    if (linki(blok).length) bledy.push(`${plik}: link do firmy w nagłówku, menu albo stopce`);
  }
}
if (wpisowZLinkiem && wpisowZLinkiem * 2 >= wpisow) {
  ostrzezenia.push(`wpisy z linkiem do firm: ${wpisowZLinkiem} z ${wpisow}, mają być w mniejszości`);
}

// Blokada 4: frazy o wydawcy strony (poza polityką prywatności, która zostaje w całości).
// Wyrażenia zapisane klasami znaków, żeby sam ten plik nie zawierał szukanych słów dosłownie.
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
const doSkanu = pliki(DIST, ['.html', '.txt', '.xml', '.json', '.webmanifest']).filter((p) => !p.includes(`${sep}polityka-prywatnosci${sep}`));
for (const plik of doSkanu) {
  const tekst = readFileSync(plik, 'utf8');
  for (const fraza of FRAZY_WYDAWCA) {
    const m = tekst.match(fraza);
    if (m) bledy.push(`${plik}: fraza o wydawcy strony "${m[0]}" (blokada: wydawcy nie ujawniamy)`);
  }
}

for (const o of ostrzezenia) console.warn(`OSTRZEŻENIE: ${o}`);
if (bledy.length) {
  console.error(bledy.join('\n'));
  process.exit(1);
}
console.log(`Linki do firm i frazy o wydawcy: zgodne z zasadami strony (plików ${doSkanu.length}, wpisów ${wpisow}, z linkiem do firm ${wpisowZLinkiem}).`);
