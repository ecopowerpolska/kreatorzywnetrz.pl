#!/usr/bin/env node
/**
 * astro-guard :: statyczny walidator projektu Astro
 * -------------------------------------------------
 * Zero zależności. Node 22+. ESM.
 *
 * Użycie:
 *   node scripts/validate-astro.mjs                 # cały projekt
 *   node scripts/validate-astro.mjs --files a.astro # tylko wskazane pliki
 *   node scripts/validate-astro.mjs --strict        # warningi też blokują
 *   node scripts/validate-astro.mjs --json          # wyjście maszynowe
 *
 * Kody wyjścia:
 *   0 = czysto (lub tylko warningi bez --strict)
 *   2 = błędy blokujące  <-- ten kod czyta hook Claude Code
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const ARGS = process.argv.slice(2);
const STRICT = ARGS.includes('--strict');
const AS_JSON = ARGS.includes('--json');
const ONLY_FILES = (() => {
  const i = ARGS.indexOf('--files');
  if (i === -1) return null;
  return ARGS.slice(i + 1)
    .filter((a) => !a.startsWith('--'))
    .flatMap((a) => a.split(','))
    .filter(Boolean);
})();

const SKIP_DIRS = new Set([
  'node_modules', 'dist', '.astro', '.git', '.vercel', '.netlify',
  '.wrangler', '.output', 'build', 'coverage', '.cache', '.vscode',
]);
const SRC_EXT = new Set(['.astro', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.vue', '.svelte', '.md', '.mdx']);

/* 🔴 POPRAWKA (ścieżki z import.meta.url).
 * Jeśli przepisujesz ten plik z kanonu na nowo, SPRAWDŹ, czy kanon STOSUJE SELF_FILES
 * w walk() i isScannable() — sama definicja bez użycia niczego nie wyłącza.
 *
 * Problem: walidator skanuje `<strona>/scripts/*.mjs`, czyli SAMEGO SIEBIE. Wyrażenie
 * reguły AG021 pasuje do własnego komunikatu tego pliku — nazwa usuniętego API stoi tu jako
 * TEKST opisu, nie jako kod strony. Skutek bez poprawki: pełny przebieg (`npm run guard`,
 * hook Stop, krok w Actions) kończył się BŁĘDAMI na każdej stronie z wdrożonym pakietem.
 *
 * Poprawka: pomijamy DOKŁADNIE dwa pliki pakietu, po pełnej ścieżce — nie po nazwie
 * i nie przez wpisanie `scripts` do SKIP_DIRS (to wyciszyłoby też prawdziwe skrypty projektu).
 * Ścieżki z import.meta.url (pakiet działa z dowolnego katalogu, np. wzorzec w
 * `narzedzia/astro-guard/`) ORAZ z ROOT/scripts (gdyby plik był dowiązaniem — Node rozwiązuje
 * wtedy import.meta.url do celu, a walk() widzi ścieżkę dowiązania).
 * Żadna reguła nie traci mocy nad kodem strony. */
const SELF_DIR = dirname(fileURLToPath(import.meta.url));
const SELF_FILES = new Set([
  join(SELF_DIR, 'validate-astro.mjs'),
  join(SELF_DIR, 'audit-dist.mjs'),
  join(ROOT, 'scripts', 'validate-astro.mjs'),
  join(ROOT, 'scripts', 'audit-dist.mjs'),
]);

const CFG = loadGuardConfig();
const findings = [];

// ─────────────────────────────────────────────────────────────────────────────
// REGUŁY LINIOWE (skanowane per linia)
// ─────────────────────────────────────────────────────────────────────────────
const LINE_RULES = [
  {
    id: 'AG020', sev: 'error', ext: ['.astro', '.mdx'],
    re: /<ViewTransitions\b/,
    msg: 'Komponent <ViewTransitions /> został usunięty w Astro 6.',
    fix: 'Zamień na <ClientRouter /> z "astro:transitions". Usuń też prop handleForms (przestarzały, bez działania). https://docs.astro.build/en/guides/upgrade-to/v6/#removed-viewtransitions--component',
  },
  {
    id: 'AG021', sev: 'error', ext: ['.astro', '.ts', '.js', '.mjs', '.mdx'],
    re: /Astro\.glob\s*\(/,
    msg: 'Astro.glob() zostało usunięte w Astro 6.',
    fix: 'Użyj import.meta.glob() (nie zwraca Promise) albo — dla treści — Content Layer API (getCollection + loader glob()). https://docs.astro.build/en/guides/upgrade-to/v6/#removed-astroglob',
  },
  /* AG022 — POPRAWIONA 2026-09-30. Wcześniej: `error` na KAŻDE wystąpienie Astro.site
   * z komunikatem "usunięte w Astro 6" — nieprawda: Astro.site istnieje w Astro 7
   * (docs.astro.build/en/reference/api-reference/ — `site`, typ `URL | undefined`;
   * node_modules/astro/dist/types/public/context.d.ts: `site: URL | undefined`). Przestarzały
   * jest wyłącznie obiekt Astro WEWNĄTRZ getStaticPaths() (upgrade-to/v6, sekcja
   * "Deprecated: Astro in getStaticPaths()"; Astro 7.3.1 wypisuje wtedy ostrzeżenie
   * w dist/runtime/server/astro-global.js). Stąd `warn` i zakres ograniczony do ciała
   * getStaticPaths(). */
  {
    id: 'AG022', sev: 'warn', ext: ['.astro', '.ts', '.js', '.mjs'], scope: 'getStaticPaths',
    re: /Astro\.(site|generator)\b/,
    msg: 'Astro.site / Astro.generator wewnątrz getStaticPaths() — przestarzałe od Astro 6 (Astro 7 wypisuje ostrzeżenie; usunięcie zapowiedziane w przyszłej wersji głównej). Poza getStaticPaths() Astro.site jest pełnoprawnym API.',
    fix: 'W getStaticPaths() zamień Astro.site na import.meta.env.SITE, a Astro.generator usuń. https://docs.astro.build/en/guides/upgrade-to/v6/#deprecated-astro-in-getstaticpaths',
  },
  {
    id: 'AG023', sev: 'error', ext: ['.astro', '.mdx'],
    re: /client:only(?!\s*=)/,
    msg: 'client:only bez wskazania frameworka nie zadziała.',
    fix: 'Napisz client:only="react" (albo "vue"/"svelte"/"solid"/"preact"). Lepiej: rozważ client:visible i render SSR.',
  },
  {
    id: 'AG024', sev: 'warn', ext: ['.astro', '.mdx'],
    re: /client:load\b/,
    msg: 'client:load ładuje JS natychmiast i blokuje główny wątek — wymaga uzasadnienia.',
    fix: 'Domyślnie client:visible (poniżej folda) lub client:idle. Jeśli komponent JEST nad foldem i musi działać od razu, dopisz w linii wyżej: <!-- guard:allow AG024 powód -->',
  },
  {
    id: 'AG025', sev: 'warn', ext: ['.astro'],
    re: /<script[^>]*\bis:inline\b/,
    msg: 'is:inline wyłącza bundlowanie, minifikację i deduplikację skryptu przez Astro.',
    fix: 'Usuń is:inline, chyba że skrypt naprawdę musi wykonać się przed hydracją (np. anty-FOUC theme). Wtedy: <!-- guard:allow AG025 powód -->',
  },
  {
    id: 'AG028', sev: 'warn', ext: ['.astro', '.html'],
    re: /fonts\.(googleapis|gstatic)\.com/,
    msg: 'Zewnętrzne fonty Google blokują render i wyciekają IP użytkownika.',
    fix: 'Użyj wbudowanego Fonts API (Astro 6+): fonts: [...] w astro.config + <Font cssVariable="--font-x" preload /> w layoucie.',
  },
  {
    id: 'AG030', sev: 'warn', ext: ['.astro'],
    re: /<script[^>]+src=["']https?:\/\//,
    msg: 'Zewnętrzny skrypt third-party ładowany bezpośrednio.',
    fix: 'Przenieś do Web Workera (@astrojs/partytown) albo ładuj po interakcji/zgodzie cookie. Sprawdź wpływ na TBT.',
  },
  {
    id: 'AG040', sev: 'error', ext: ['.astro'], scope: 'frontmatter',
    re: /\b(window|document|localStorage|sessionStorage|navigator)\s*[.\[]/,
    msg: 'Odwołanie do API przeglądarki we frontmatterze .astro — ten kod wykonuje się na serwerze/w buildzie.',
    fix: 'Przenieś do <script> w części szablonu albo do komponentu z dyrektywą client:*.',
  },
  {
    id: 'AG042', sev: 'warn', ext: ['.astro', '.ts', '.tsx', '.js', '.jsx'],
    re: /process\.env\./,
    msg: 'process.env nie jest przenośne między runtime’ami (Cloudflare/Deno/Bun) i nie waliduje typów.',
    fix: 'Użyj astro:env (envField.string/number/boolean + import z astro:env/server|client) albo import.meta.env.',
  },
  {
    id: 'AG043', sev: 'warn', ext: ['.ts', '.js', '.mjs'], only: /content\.config\.(ts|js|mjs)$/,
    re: /from\s+["']zod["']/,
    msg: 'Bezpośredni import z "zod" w konfiguracji kolekcji — Astro 6 używa Zod 4 i udostępnia tę samą instancję jako "astro/zod".',
    fix: 'import { z } from "astro/zod". NIE z "astro:content" ani "astro:schema" — oba przestarzałe od Astro 6. Podwójny Zod = konflikt wersji przy walidacji schematów. https://docs.astro.build/en/guides/upgrade-to/v6/#deprecated-astroschema-and-z-from-astrocontent',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// URUCHOMIENIE
// ─────────────────────────────────────────────────────────────────────────────
const files = ONLY_FILES ? ONLY_FILES.map(abs).filter(isScannable) : walk(ROOT);

for (const file of files) scanFile(file);
if (!ONLY_FILES) {
  checkAstroConfig();
  checkPackageJson();
  checkContentCollections();
  checkProjectHygiene();
}

report();

// ─────────────────────────────────────────────────────────────────────────────
// SKANY PLIKOWE
// ─────────────────────────────────────────────────────────────────────────────
function scanFile(file) {
  const ext = extname(file);
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return; }
  const lines = text.split(/\r?\n/);
  const fmEnd = ext === '.astro' ? frontmatterEnd(lines) : -1;
  let gspLines = null; // wiersze ciał getStaticPaths(), liczone tylko, gdy reguła ich potrzebuje

  for (const rule of LINE_RULES) {
    if (!rule.ext.includes(ext)) continue;
    if (rule.only && !rule.only.test(file)) continue;
    if (rule.scope === 'getStaticPaths' && gspLines === null) gspLines = getStaticPathsLines(text);
    lines.forEach((line, i) => {
      if (rule.scope === 'frontmatter' && i > fmEnd) return;
      if (rule.scope === 'getStaticPaths' && !gspLines.has(i)) return;
      if (!rule.re.test(line)) return;
      if (isAllowed(lines, i, rule.id)) return;
      add(rule.sev, rule.id, file, i + 1, rule.msg, rule.fix, line.trim().slice(0, 120));
    });
  }

  if (ext === '.astro' || ext === '.mdx') {
    checkImages(file, text);
    checkIslandBudget(file, text);
  }
}

function checkImages(file, text) {
  for (const { tag, index } of matchTags(text, 'img')) {
    const ln = lineOf(text, index);
    const hasSize = /\bwidth\s*=/.test(tag) && /\bheight\s*=/.test(tag);
    const src = (tag.match(/\bsrc\s*=\s*["'{]([^"'}]+)/) || [])[1] || '';
    if (!hasSize && !/\bstyle\s*=\s*["'][^"']*aspect-ratio/.test(tag)) {
      add('warn', 'AG026', file, ln,
        'Surowy <img> bez width/height — bezpośrednia przyczyna CLS.',
        'Dodaj width i height (albo aspect-ratio w CSS).', tag.slice(0, 120));
    }
    if (/^[./]|^~\/|^@\//.test(src) && !/\.svg($|\?)/.test(src)) {
      add('warn', 'AG027', file, ln,
        'Lokalny raster serwowany surowym <img> — brak konwersji do AVIF/WebP i responsywnych rozmiarów.',
        'Zaimportuj obraz i użyj <Image /> lub <Picture /> z "astro:assets". SVG zostaw jako <img>/inline.', tag.slice(0, 120));
    }
  }
  for (const { tag, index } of matchTags(text, 'Image')) {
    if (/loading\s*=\s*["']eager["']/.test(tag) && !/fetchpriority\s*=\s*["']high["']/.test(tag)) {
      add('info', 'AG034', file, lineOf(text, index),
        'Obraz LCP z loading="eager" bez fetchpriority="high".',
        'Dodaj fetchpriority="high" do jednego, głównego obrazu nad foldem. Reszta: domyślne lazy.', tag.slice(0, 120));
    }
  }
}

function checkIslandBudget(file, text) {
  const count = (text.match(/client:(load|visible|idle|media|only)/g) || []).length;
  const max = CFG.maxIslandsPerFile;
  if (count > max) {
    add('warn', 'AG029', file, 1,
      `Plik zawiera ${count} wysp interaktywnych (budżet: ${max}).`,
      'Rozbij komponenty: hydratuj tylko realnie interaktywny fragment (np. sam przycisk), a nie całą sekcję.');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SKANY PROJEKTOWE
// ─────────────────────────────────────────────────────────────────────────────
function checkAstroConfig() {
  const candidates = ['astro.config.mjs', 'astro.config.ts', 'astro.config.mts', 'astro.config.js', 'astro.config.cjs'];
  const found = candidates.map((c) => join(ROOT, c)).filter(existsSync);

  if (found.length === 0) {
    add('error', 'AG000', join(ROOT, 'astro.config.mjs'), 1,
      'Brak pliku astro.config.* w katalogu głównym.',
      'To nie jest projekt Astro albo pracujesz w złym katalogu. Zatrzymaj się i zweryfikuj ścieżkę.');
    return;
  }
  const cjs = found.find((f) => f.endsWith('.cjs'));
  if (cjs) {
    add('error', 'AG002', cjs, 1,
      'Konfiguracja w formacie CommonJS nie jest wspierana od Astro 6.',
      'Zmień nazwę na astro.config.mjs i przepisz na składnię ESM (import/export default).');
  }

  const file = found[0];
  const text = readFileSync(file, 'utf8');

  if (/output\s*:\s*["']hybrid["']/.test(text)) {
    add('error', 'AG001', file, lineOf(text, text.search(/output\s*:\s*["']hybrid["']/)),
      'output: "hybrid" zostało usunięte w Astro 5 — Astro 7 odrzuca konfigurację własnym komunikatem błędu (schemat konfiguracji: "The output: hybrid option has been removed").',
      'Zostaw output: "static" (domyślne) i oznaczaj pojedyncze trasy przez `export const prerender = false`. output: "server" tylko wtedy, gdy CAŁA witryna ma być dynamiczna. https://docs.astro.build/en/guides/upgrade-to/v5/#removed-hybrid-rendering-mode');
  }
  if (/@astrojs\/tailwind/.test(text)) {
    add('error', 'AG005', file, lineOf(text, text.indexOf('@astrojs/tailwind')),
      'Integracja @astrojs/tailwind jest przestarzała (dotyczy Tailwind 3).',
      'Usuń ją z integrations. Zainstaluj tailwindcss + @tailwindcss/vite i zarejestruj plugin w vite.plugins. Konfiguracja przechodzi do CSS: @import "tailwindcss" + @theme {}.');
  }
  // AG006 — POPRAWIONA 2026-09-30: flagi szukane WYŁĄCZNIE jako klucze pierwszego poziomu
  // bloku `experimental: { … }`. Wcześniej wystarczyło `logger:` gdziekolwiek w pliku, a Astro 7
  // ma `logger` i `cache` jako opcje NAJWYŻSZEGO poziomu (fałszywy błąd), a flaga `cache` była
  // szukana pod złą nazwą `experimentalCache` (przeoczenie). Astro 7.3.1 ma `experimental`
  // jako z.strictObject — nieznany klucz = błąd konfiguracji.
  const removedFlags = /\b(rustCompiler|queuedRendering|advancedRouting|cache|logger)\s*:/;
  const expAt = text.search(/\bexperimental\s*:\s*\{/);
  if (expAt !== -1) {
    const open = text.indexOf('{', expAt);
    const close = matchBrace(text, open);
    const flagi = close === -1 ? '' : topLevelText(text.slice(open, close + 1));
    const trafienie = flagi.match(removedFlags);
    if (trafienie) {
      add('error', 'AG006', file, lineOf(text, expAt),
        `Flaga experimental.${trafienie[1]} — flagi rustCompiler, queuedRendering, advancedRouting, cache i logger usunięte w Astro 7, ich zachowania są już standardem.`,
        'Usuń te flagi z bloku experimental (cache i logger mają dziś własne opcje najwyższego poziomu). Zostawione powodują błąd konfiguracji. https://docs.astro.build/en/guides/upgrade-to/v7/#experimental-flags');
    }
  }
  if (!/\bsite\s*:/.test(text)) {
    add('warn', 'AG003', file, 1,
      'Brak `site` w konfiguracji.',
      'Bez `site` nie wygenerujesz poprawnego sitemap.xml ani kanonicznych URL-i — to bezpośrednia strata SEO.');
  }
  if (!/prefetch/.test(text)) {
    add('info', 'AG004', file, 1,
      'Prefetch nie jest skonfigurowany.',
      'Dodaj prefetch: { prefetchAll: true, defaultStrategy: "hover" }. Dla kluczowych CTA: data-astro-prefetch="viewport".');
  }
  if (/@astrojs\/partytown/.test(text)) {
    add('info', 'AG007', file, lineOf(text, text.indexOf('@astrojs/partytown')),
      'Partytown w projekcie — przenosi third-party do Web Workera, ale jego service worker bywa raportowany przez Lighthouse w sekcji "Uses deprecated APIs".',
      'Zweryfikuj realny zysk pomiarem TBT przed/po. Alternatywa: ładowanie analityki dopiero po zgodzie cookie / pierwszej interakcji.');
  }
}

function checkPackageJson() {
  const file = join(ROOT, 'package.json');
  if (!existsSync(file)) return;
  let pkg;
  try { pkg = JSON.parse(readFileSync(file, 'utf8')); } catch {
    add('error', 'AG019', file, 1, 'package.json jest niepoprawnym JSON-em.', 'Napraw składnię przed dalszą pracą.');
    return;
  }
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

  if (deps['@astrojs/tailwind']) {
    add('error', 'AG010', file, 1,
      'Pakiet @astrojs/tailwind w zależnościach (legacy, Tailwind 3).',
      'npm uninstall @astrojs/tailwind && npm install tailwindcss @tailwindcss/vite');
  }
  const astroMajor = majorOf(deps.astro);
  if (astroMajor && astroMajor < CFG.minAstroMajor) {
    add('warn', 'AG012', file, 1,
      `Astro ${deps.astro} — projekt poniżej rekomendowanego majora ${CFG.minAstroMajor}.`,
      'Zaplanuj `npx @astrojs/upgrade` w osobnym PR. Nie mieszaj migracji z nowymi funkcjami.');
  }
  const nodeReq = majorOf(pkg.engines?.node);
  if (!nodeReq) {
    add('warn', 'AG011', file, 1,
      'Brak engines.node w package.json.',
      'Astro 6+ wymaga Node 22.12+. Dopisz "engines": { "node": ">=22.12.0" } i zsynchronizuj .nvmrc oraz runtime na hostingu.');
  } else if (nodeReq < 22) {
    add('error', 'AG011', file, 1,
      `engines.node wskazuje Node ${nodeReq} — Astro 6+ wymaga Node 22.12+.`,
      'Podnieś engines.node, .nvmrc i wersję Node w CI/hostingu.');
  }
  if (Object.keys(deps).some((d) => d.startsWith('@fontsource'))) {
    add('info', 'AG013', file, 1,
      'Pakiety @fontsource — od Astro 6 fonty obsługuje wbudowane Fonts API.',
      'fonts: [{ provider: fontProviders.fontsource(), name: "Inter", cssVariable: "--font-inter" }] + <Font cssVariable="--font-inter" preload />. Astro samo pobierze pliki, wygeneruje fallbacki i preloady.');
  }
  const scripts = pkg.scripts || {};
  if (!scripts.guard) {
    add('info', 'AG014', file, 1,
      'Brak skrótu `npm run guard`.',
      'Dodaj: "guard": "node scripts/validate-astro.mjs", "guard:build": "node scripts/audit-dist.mjs", "verify": "npm run guard && astro check && astro build && npm run guard:build".');
  }
  // AG017: pamięć content layer (data-store.json) po zmianie wtyczki Markdown daje stary HTML.
  const bezForce = ['build', 'verify'].some((k) => /\bastro build\b(?!\s+--force)/.test(scripts[k] || ''));
  if (bezForce && !/data-store/.test(scripts.prebuild || '')) {
    add('info', 'AG017', file, 1,
      'Skrypt build/verify woła `astro build` bez --force: po zmianie wtyczki Markdown lokalny build weźmie stary HTML z node_modules/.astro/data-store.json.',
      '"build": "astro build --force" (i to samo w verify) albo prebuild usuwający node_modules/.astro/data-store.json.');
  }
}

function checkContentCollections() {
  // POPRAWKA 2026-09-30: Astro 6.0 dodało flagę legacy.collectionsBackwardsCompat
  // (docs.astro.build/en/reference/legacy-flags/), która TYMCZASOWO przywraca
  // src/content/config.ts i kolekcje bez loadera. Z nią AG031/AG032 są ostrzeżeniem, nie błędem.
  const flagaLegacy = /\bcollectionsBackwardsCompat\s*:\s*true\b/.test(readAstroConfigText());
  const legacy = ['src/content/config.ts', 'src/content/config.js', 'src/content/config.mjs']
    .map((p) => join(ROOT, p)).filter(existsSync);
  for (const f of legacy) {
    if (flagaLegacy) {
      add('warn', 'AG031', f, 1,
        'Stara lokalizacja konfiguracji kolekcji działa tylko dzięki legacy.collectionsBackwardsCompat — tymczasowej fladze migracji.',
        'Przenieś plik do src/content.config.ts, dodaj loadery i wyłącz flagę. https://docs.astro.build/en/reference/legacy-flags/');
      continue;
    }
    add('error', 'AG031', f, 1,
      'Stare kolekcje treści (src/content/config.*) usunięte w Astro 6 — bez flagi legacy.collectionsBackwardsCompat build pada.',
      'Przenieś plik do src/content.config.ts i zdefiniuj kolekcje przez Content Layer API: defineCollection({ loader: glob({ pattern: "**/*.md", base: "./src/data/blog" }), schema: ... }). https://docs.astro.build/en/guides/upgrade-to/v6/#removed-legacy-content-collections');
  }
  const modern = ['src/content.config.ts', 'src/content.config.js', 'src/content.config.mjs']
    .map((p) => join(ROOT, p)).find(existsSync);
  if (modern) {
    const text = readFileSync(modern, 'utf8');
    if (/defineCollection\s*\(/.test(text) && !/loader\s*:/.test(text)) {
      add(flagaLegacy ? 'warn' : 'error', 'AG032', modern, lineOf(text, text.search(/defineCollection\s*\(/)),
        flagaLegacy
          ? 'defineCollection() bez `loader` działa tylko dzięki legacy.collectionsBackwardsCompat — tymczasowej fladze migracji.'
          : 'defineCollection() bez `loader` — w Astro 6+ bez flagi legacy.collectionsBackwardsCompat kolekcja bez loadera nie istnieje.',
        'Dodaj loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/data/<kolekcja>" }) albo file()/własny loader dla danych zewnętrznych.');
    }
  }
}

function checkProjectHygiene() {
  const nvmrc = join(ROOT, '.nvmrc');
  if (existsSync(nvmrc)) {
    const v = majorOf(readFileSync(nvmrc, 'utf8').trim());
    if (v && v < 22) {
      add('error', 'AG015', nvmrc, 1,
        `.nvmrc wskazuje Node ${v} — Astro 6+ wymaga Node 22.12+.`,
        'Ustaw 22 (lub nowszy LTS) i zweryfikuj to samo w CI oraz na hostingu.');
    }
  }
  const robots = join(ROOT, 'public/robots.txt');
  if (!existsSync(robots)) {
    add('info', 'AG016', join(ROOT, 'public'), 1,
      'Brak public/robots.txt.',
      'Dodaj robots.txt ze wskazaniem sitemapy — strona treściowa bez tego traci na indeksacji.');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// NARZĘDZIA
// ─────────────────────────────────────────────────────────────────────────────
/** Tekst pierwszego istniejącego astro.config.* ('' gdy brak). */
function readAstroConfigText() {
  for (const c of ['astro.config.mjs', 'astro.config.ts', 'astro.config.mts', 'astro.config.js', 'astro.config.cjs']) {
    const f = join(ROOT, c);
    if (existsSync(f)) {
      try { return readFileSync(f, 'utf8'); } catch { return ''; }
    }
  }
  return '';
}

/* Minimalny skaner JS/TS: pomija literały napisów, szablony z ${…} i komentarze, żeby liczyć
 * nawiasy tylko w kodzie. Wyrażeń regularnych nie rozpoznaje — w ciele getStaticPaths() i w bloku
 * experimental praktycznie nie występują; pomyłka daje najwyżej brak ostrzeżenia. */
function skipNonCode(text, i) {
  const c = text[i];
  const n = text[i + 1];
  if (c === '/' && n === '/') { const e = text.indexOf('\n', i); return e === -1 ? text.length : e; }
  if (c === '/' && n === '*') { const e = text.indexOf('*/', i + 2); return e === -1 ? text.length : e + 2; }
  if (c === '"' || c === "'") {
    for (let j = i + 1; j < text.length; j++) {
      if (text[j] === '\\') { j++; continue; }
      if (text[j] === c || text[j] === '\n') return j + 1;
    }
    return text.length;
  }
  if (c === '`') {
    for (let j = i + 1; j < text.length; j++) {
      if (text[j] === '\\') { j++; continue; }
      if (text[j] === '`') return j + 1;
      if (text[j] === '$' && text[j + 1] === '{') {
        const e = matchBrace(text, j + 1);
        if (e === -1) return text.length;
        j = e;
      }
    }
    return text.length;
  }
  return -1;
}

/** Indeks nawiasu zamykającego dla otwierającego w `open` ({, ( albo [); -1 gdy brak pary. */
function matchBrace(text, open) {
  const pary = { '{': '}', '(': ')', '[': ']' };
  if (!pary[text[open]]) return -1;
  const stos = [];
  for (let i = open; i < text.length; i++) {
    const s = skipNonCode(text, i);
    if (s !== -1) { i = s - 1; continue; }
    const c = text[i];
    if (pary[c]) stos.push(pary[c]);
    else if (c === '}' || c === ')' || c === ']') {
      if (stos.pop() !== c) return -1;
      if (stos.length === 0) return i;
    }
  }
  return -1;
}

/** Z bloku `{ … }` zostawia tylko tekst pierwszego poziomu (zagnieżdżone nawiasy i literały wypadają). */
function topLevelText(block) {
  let out = '';
  let depth = 0;
  for (let i = 0; i < block.length; i++) {
    const s = skipNonCode(block, i);
    if (s !== -1) { out += ' '; i = s - 1; continue; }
    const c = block[i];
    if (c === '{' || c === '(' || c === '[') { depth++; if (depth === 2) out += ' '; continue; }
    if (c === '}' || c === ')' || c === ']') { depth--; continue; }
    if (depth === 1) out += c;
  }
  return out;
}

/** Numery wierszy (od 0) leżących w ciele deklaracji getStaticPaths():
 *  `function getStaticPaths(…) {…}` albo `getStaticPaths[: Typ] = … => {…}` / `= function (…) {…}`.
 *  Ciało = pierwszy `{` poprzedzony `)` albo `=>`, bez `;` po drodze (inaczej to nie ta deklaracja). */
function getStaticPathsLines(text) {
  const wynik = new Set();
  const re = /\bgetStaticPaths\b/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const przed = text.slice(Math.max(0, m.index - 20), m.index);
    const po = text.slice(m.index + m[0].length, m.index + m[0].length + 200);
    const deklaracja = /function\s*\*?\s*$/.test(przed) ? /^\s*\(/.test(po) : /^\s*(?::[^=;]*)?=(?![=>])/.test(po);
    if (!deklaracja) continue;
    let otw = -1;
    for (let i = m.index + m[0].length; i < Math.min(text.length, m.index + 400); i++) {
      const s = skipNonCode(text, i);
      if (s !== -1) { i = s - 1; continue; }
      if (text[i] === ';') break;
      if (text[i] !== '{') continue;
      const wczesniej = text.slice(m.index, i).trimEnd();
      if (wczesniej.endsWith(')') || wczesniej.endsWith('=>')) { otw = i; break; }
    }
    if (otw === -1) continue;
    const zam = matchBrace(text, otw);
    if (zam === -1) continue;
    const od = lineOf(text, otw) - 1;
    const doW = lineOf(text, zam) - 1;
    for (let l = od; l <= doW; l++) wynik.add(l);
  }
  return wynik;
}

function walk(dir, acc = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, acc);
    else if (SRC_EXT.has(extname(full)) && !SELF_FILES.has(full)) acc.push(full);
  }
  return acc;
}

function isScannable(f) {
  // SELF_FILES także tutaj: tryb --files to droga hooka PostToolUse, więc bez tego
  // każda edycja samego pakietu zgłaszałaby te same fałszywe trafienia co pełny przebieg.
  return (
    existsSync(f) &&
    SRC_EXT.has(extname(f)) &&
    !SELF_FILES.has(f) &&
    !f.split(sep).some((p) => SKIP_DIRS.has(p))
  );
}

function abs(p) {
  return p.startsWith('/') ? p : join(ROOT, p);
}

function frontmatterEnd(lines) {
  if (lines[0]?.trim() !== '---') return -1;
  for (let i = 1; i < lines.length; i++) if (lines[i].trim() === '---') return i;
  return -1;
}

function isAllowed(lines, i, ruleId) {
  const window = [lines[i], lines[i - 1], lines[i - 2]].filter(Boolean).join('\n');
  return new RegExp(`guard:allow\\s+${ruleId}`).test(window) || /guard:ignore/.test(lines[i] || '');
}

function matchTags(text, tagName) {
  const out = [];
  const re = new RegExp(`<${tagName}\\b[^>]*>`, 'gs');
  let m;
  while ((m = re.exec(text)) !== null) out.push({ tag: m[0], index: m.index });
  return out;
}

function lineOf(text, index) {
  if (index < 0) return 1;
  return text.slice(0, index).split('\n').length;
}

function majorOf(range) {
  if (!range) return null;
  const m = String(range).match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

function loadGuardConfig() {
  const defaults = { maxIslandsPerFile: 3, minAstroMajor: 6 };
  const f = join(ROOT, 'guard.config.json');
  if (!existsSync(f)) return defaults;
  try { return { ...defaults, ...JSON.parse(readFileSync(f, 'utf8')).static }; } catch { return defaults; }
}

function add(sev, rule, file, line, msg, fix, snippet) {
  findings.push({ sev, rule, file: relative(ROOT, file) || file, line, msg, fix, snippet });
}

function report() {
  const errors = findings.filter((f) => f.sev === 'error');
  const warns = findings.filter((f) => f.sev === 'warn');
  const infos = findings.filter((f) => f.sev === 'info');

  if (AS_JSON) {
    process.stdout.write(JSON.stringify({ errors, warns, infos }, null, 2) + '\n');
  } else {
    const stream = errors.length ? process.stderr : process.stdout;
    const line = (f) => {
      const tag = f.sev === 'error' ? 'BŁĄD ' : f.sev === 'warn' ? 'OSTRZ' : 'INFO ';
      let s = `\n[${tag}] ${f.rule}  ${f.file}:${f.line}\n  → ${f.msg}\n  ✎ ${f.fix}`;
      if (f.snippet) s += `\n  … ${f.snippet}`;
      return s;
    };
    if (findings.length === 0) {
      process.stdout.write('astro-guard: czysto. Zero naruszeń.\n');
    } else {
      stream.write('═══ astro-guard ═══');
      for (const f of [...errors, ...warns, ...infos]) stream.write(line(f));
      stream.write(`\n\nPodsumowanie: ${errors.length} błędów, ${warns.length} ostrzeżeń, ${infos.length} informacji.\n`);
      if (errors.length) {
        stream.write('Błędy są blokujące: napraw je i uruchom walidator ponownie. Nie raportuj zadania jako ukończone.\n');
      }
    }
  }

  if (errors.length > 0 || (STRICT && warns.length > 0)) process.exit(2);
  process.exit(0);
}
