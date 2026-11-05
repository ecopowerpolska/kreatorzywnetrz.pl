#!/usr/bin/env node
// sprawdz-linki-firm.mjs — bramka linków do polecanych firm w dist/:
// 1) w treści wpisu (<article class="wpis...") najwyżej 1 link do firm, bez rel;
// 2) poza treścią wpisu każdy link do firm ma rel="nofollow"; 3) w nagłówku, menu i stopce nie ma żadnego;
// 4) blokada: w dist/**/*.html (poza polityka-prywatnosci/), dist/llms.txt i dist/.well-known/*.json nie ma fraz o wydawcy strony.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';

const FIRMY = /^https?:\/\/(?:[a-z0-9-]+\.)?(studioagat\.pl|nadihome\.pl|pan-stolarz\.pl)(?:[/?#]|$)/i;
const DIST = join(process.cwd(), process.argv[2] ?? 'dist');
const bledy = [];
const pliki = (d, rozszerzenie = '.html') =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? pliki(join(d, e.name), rozszerzenie) : e.name.endsWith(rozszerzenie) ? [join(d, e.name)] : []));

for (const plik of pliki(DIST)) {
  const html = readFileSync(plik, 'utf8');
  const wpis = html.match(/<article class="wpis[ "][^>]*>[\s\S]*?<\/article>/)?.[0] ?? '';
  const poza = html.replace(wpis, '');
  const linki = (s) => [...s.matchAll(/<a\b([^>]*)>/g)].map((m) => ({ a: m[1], href: m[1].match(/href="([^"]+)"/)?.[1] ?? '' })).filter((l) => FIRMY.test(l.href));
  const wTresci = linki(wpis);
  if (wTresci.length > 1) bledy.push(`${plik}: ${wTresci.length} linków do firm w treści wpisu (dozwolony 1)`);
  for (const l of wTresci) {
    if (/\brel=/.test(l.a)) bledy.push(`${plik}: link w treści wpisu z rel (${l.href}) — ma być bez rel`);
  }
  for (const l of linki(poza)) if (!/rel="[^"]*nofollow/.test(l.a)) bledy.push(`${plik}: link do firmy poza treścią wpisu bez nofollow (${l.href})`);
  for (const blok of html.match(/<(header|footer)\b[\s\S]*?<\/\1>/g) ?? []) if (linki(blok).length) bledy.push(`${plik}: link do firmy w nagłówku albo stopce`);
}

// Blokada 4: frazy o wydawcy strony (poza polityką prywatności, która zostaje w całości).
// Wyrażenia zapisane klasami znaków, żeby sam ten plik nie zawierał szukanych słów dosłownie.
const FRAZY_WYDAWCA = [
  /eco\s?power/i,
  /api\.eco/i,
  /sp[oó]łk[aięąo]/i,
  /sp\.\s?z\s?o\.\s?o\./i,
  /wydaje t[eę] stron[eę]/i,
  /wydaj[aą]ca t[eę] stron[eę]/i,
  /stron[eę] wydaje/i,
  /ta sama firma/i,
  /parentOrganization/,
];
const doSkanu = pliki(DIST).filter((p) => !p.includes(`${sep}polityka-prywatnosci${sep}`));
for (const dodatkowy of ['llms.txt', 'rss.xml']) if (existsSync(join(DIST, dodatkowy))) doSkanu.push(join(DIST, dodatkowy));
if (existsSync(join(DIST, '.well-known'))) doSkanu.push(...pliki(join(DIST, '.well-known'), '.json'));
for (const plik of doSkanu) {
  const tekst = readFileSync(plik, 'utf8');
  for (const fraza of FRAZY_WYDAWCA) {
    const m = tekst.match(fraza);
    if (m) bledy.push(`${plik}: fraza o wydawcy strony „${m[0]}” (blokada: wydawcy nie ujawniamy)`);
  }
}
if (bledy.length) { console.error(bledy.join('\n')); process.exit(1); }
console.log('Linki do firm i frazy o wydawcy: zgodne z zasadami strony.');
