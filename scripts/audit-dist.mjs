#!/usr/bin/env node
/**
 * astro-guard :: audyt wyniku builda (dist/)
 * ------------------------------------------
 * Statyczny walidator sprawdza kod. Ten skrypt sprawdza PRAWDĘ: to, co faktycznie
 * poleciało do przeglądarki. Waży JS/CSS per strona (gzip), weryfikuje podstawy SEO
 * i wyłapuje obrazy bez wymiarów w finalnym HTML-u.
 *
 * Użycie:
 *   npm run build && node scripts/audit-dist.mjs
 *   node scripts/audit-dist.mjs --dir dist --json
 *
 * Kody wyjścia: 0 = w budżecie, 2 = przekroczenie lub braki SEO.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, extname } from 'node:path';
import { gzipSync } from 'node:zlib';

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const ARGS = process.argv.slice(2);
const AS_JSON = ARGS.includes('--json');
const DIST = join(ROOT, argValue('--dir') || 'dist');

const CFG = loadBudget();
const pages = [];
const problems = [];

if (!existsSync(DIST)) {
  process.stderr.write(`astro-guard: brak katalogu ${relative(ROOT, DIST)}. Uruchom najpierw build.\n`);
  process.exit(2);
}

for (const html of walk(DIST).filter((f) => extname(f) === '.html')) auditPage(html);
report();

// ─────────────────────────────────────────────────────────────────────────────
function auditPage(file) {
  const text = readFileSync(file, 'utf8');
  const url = '/' + relative(DIST, file).replace(/index\.html$/, '').replace(/\\/g, '/');

  const assets = new Set();
  for (const m of text.matchAll(/<script[^>]+src=["']([^"']+)["']/g)) assets.add(m[1]);
  for (const m of text.matchAll(/<link[^>]+rel=["']modulepreload["'][^>]*href=["']([^"']+)["']/g)) assets.add(m[1]);
  for (const m of text.matchAll(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']modulepreload["']/g)) assets.add(m[1]);

  const styles = new Set();
  for (const m of text.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/g)) styles.add(m[1]);
  for (const m of text.matchAll(/<link[^>]+href=["']([^"']+\.css)["']/g)) styles.add(m[1]);

  let inlineJs = 0;
  for (const m of text.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    if (/type=["']application\/ld\+json["']/.test(m[0])) continue; // dane strukturalne to nie kod
    inlineJs += Buffer.byteLength(m[1], 'utf8');
  }
  let inlineCss = 0;
  for (const m of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) inlineCss += Buffer.byteLength(m[1], 'utf8');

  const jsBytes = [...assets].filter((a) => !a.endsWith('.css')).reduce((s, a) => s + sizeOf(a, file), 0) + inlineJs;
  const cssBytes = [...styles].reduce((s, a) => s + sizeOf(a, file), 0) + inlineCss;
  const htmlGzip = gzipSync(Buffer.from(text)).length;

  const page = {
    url,
    jsKB: kb(jsBytes),
    jsGzipKB: kb(gzipEstimate(jsBytes)),
    cssGzipKB: kb(gzipEstimate(cssBytes)),
    htmlGzipKB: kb(htmlGzip),
    islands: [...assets].filter((a) => !a.endsWith('.css')).length,
  };
  pages.push(page);

  // ── budżety ────────────────────────────────────────────────────────────────
  if (page.jsGzipKB > CFG.jsGzipKB) {
    flag('error', 'B01', url, `JS ${page.jsGzipKB} kB gzip przekracza budżet ${CFG.jsGzipKB} kB.`,
      'Sprawdź, które wyspy ładują się na tej stronie. Zamień client:load → client:visible, rozbij komponent, albo przenieś logikę na serwer (server:defer).');
  }
  if (page.cssGzipKB > CFG.cssGzipKB) {
    flag('warn', 'B02', url, `CSS ${page.cssGzipKB} kB gzip przekracza budżet ${CFG.cssGzipKB} kB.`,
      'Sprawdź globalne arkusze importowane w layoucie — style w <style> wewnątrz .astro są scoped i trafiają tylko tam, gdzie są potrzebne.');
  }
  // Budżet HTML per strona (2026-10-09): wpis w budget.htmlGzipKBTrasy ma pierwszeństwo przed globalnym
  // progiem — przyjęte przekroczenie /galeria.html (powód w guard.config.json). Klucz = url jak tutaj.
  const progHtml = CFG.htmlGzipKBTrasy?.[url] ?? CFG.htmlGzipKB;
  if (page.htmlGzipKB > progHtml) {
    flag('warn', 'B03', url, `HTML ${page.htmlGzipKB} kB gzip przekracza budżet ${progHtml} kB.`,
      'Zwykle oznacza dużą ilość zinline’owanego CSS/danych. Rozważ podział strony lub paginację.');
  }
  if (CFG.zeroJsRoutes.some((p) => matchGlob(p, url)) && page.jsGzipKB > 0.5) {
    flag('error', 'B04', url, `Trasa zadeklarowana jako zero-JS wysyła ${page.jsGzipKB} kB JS.`,
      'Usuń dyrektywy client:* z tej ścieżki albo zaktualizuj zeroJsRoutes w guard.config.json.');
  }

  // ── SEO / dostępność ───────────────────────────────────────────────────────
  if (!/<html[^>]+\blang=/.test(text)) {
    flag('error', 'B10', url, 'Brak atrybutu lang na <html>.', 'Ustaw <html lang="pl"> w layoucie bazowym.');
  }
  if (!/<title>[^<]{1,}<\/title>/.test(text)) {
    flag('error', 'B11', url, 'Brak niepustego <title>.', 'Tytuł ustaw przez props layoutu, nie na sztywno.');
  }
  if (!/<meta[^>]+name=["']description["'][^>]*content=["'][^"']{20,}/.test(text)) {
    flag('warn', 'B12', url, 'Brak meta description (lub krótsza niż 20 znaków).', 'Dodaj opis 120–160 znaków, unikalny dla strony.');
  }
  if (!/<link[^>]+rel=["']canonical["']/.test(text)) {
    flag('warn', 'B13', url, 'Brak linku kanonicznego.', 'Wygeneruj z import.meta.env.SITE + Astro.url.pathname (wymaga `site` w konfiguracji).');
  }
  const h1 = (text.match(/<h1[\s>]/g) || []).length;
  if (h1 !== 1) {
    flag('warn', 'B14', url, `Liczba nagłówków <h1>: ${h1} (oczekiwano dokładnie 1).`, 'Jeden H1 na stronę, reszta jako H2/H3 w logicznej hierarchii.');
  }
  const imgsNoSize = [...text.matchAll(/<img\b[^>]*>/g)]
    .filter((m) => !(/\bwidth=/.test(m[0]) && /\bheight=/.test(m[0]))).length;
  if (imgsNoSize > 0) {
    flag('warn', 'B15', url, `${imgsNoSize} obraz(y) bez width/height w finalnym HTML.`, 'To realny CLS mierzony przez Core Web Vitals. Uzupełnij wymiary u źródła.');
  }
  if (/loading=["']lazy["']/.test(firstImage(text) || '')) {
    flag('info', 'B16', url, 'Pierwszy obraz na stronie ma loading="lazy" — jeśli to obraz LCP, opóźnia go o jedną rundę.',
      'Kandydat na LCP: loading="eager" + fetchpriority="high".');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
function sizeOf(href, fromHtml) {
  const clean = href.split('?')[0].split('#')[0];
  if (/^https?:\/\//.test(clean)) return 0; // zasób zewnętrzny — nie waży naszego builda
  const candidates = [
    join(DIST, clean.replace(/^\//, '')),
    join(dirname(fromHtml), clean),
  ];
  for (const c of candidates) {
    try { if (statSync(c).isFile()) return statSync(c).size; } catch { /* szukaj dalej */ }
  }
  return 0;
}

function gzipEstimate(bytes) {
  return Math.round(bytes * 0.34); // stały współczynnik: JS/CSS po minifikacji pakuje się ~3x
}

function firstImage(text) {
  const m = text.match(/<img\b[^>]*>/);
  return m ? m[0] : null;
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

function matchGlob(pattern, url) {
  const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$');
  return re.test(url);
}

function kb(bytes) { return Math.round((bytes / 1024) * 10) / 10; }
function argValue(flag) { const i = ARGS.indexOf(flag); return i === -1 ? null : ARGS[i + 1]; }
function flag(sev, id, url, msg, fix) { problems.push({ sev, id, url, msg, fix }); }

function loadBudget() {
  const defaults = { jsGzipKB: 40, cssGzipKB: 30, htmlGzipKB: 25, htmlGzipKBTrasy: {}, zeroJsRoutes: [] };
  const f = join(ROOT, 'guard.config.json');
  if (!existsSync(f)) return defaults;
  try { return { ...defaults, ...JSON.parse(readFileSync(f, 'utf8')).budget }; } catch { return defaults; }
}

function report() {
  const errors = problems.filter((p) => p.sev === 'error');
  const warns = problems.filter((p) => p.sev === 'warn');

  if (AS_JSON) {
    process.stdout.write(JSON.stringify({ pages, problems }, null, 2) + '\n');
    process.exit(errors.length ? 2 : 0);
  }

  const out = errors.length ? process.stderr : process.stdout;
  out.write(`═══ astro-guard :: audyt dist (${pages.length} stron) ═══\n\n`);

  const worst = [...pages].sort((a, b) => b.jsGzipKB - a.jsGzipKB).slice(0, 10);
  out.write('Najcięższe strony (JS gzip):\n');
  for (const p of worst) {
    out.write(`  ${String(p.jsGzipKB).padStart(6)} kB JS | ${String(p.cssGzipKB).padStart(5)} kB CSS | ${String(p.islands).padStart(2)} wysp | ${p.url}\n`);
  }

  const zeroJs = pages.filter((p) => p.jsGzipKB <= 0.5).length;
  out.write(`\nStron bez JavaScriptu: ${zeroJs}/${pages.length}\n`);

  if (problems.length) {
    out.write('\nZnalezione problemy:\n');
    for (const p of [...errors, ...warns, ...problems.filter((x) => x.sev === 'info')]) {
      const tag = p.sev === 'error' ? 'BŁĄD ' : p.sev === 'warn' ? 'OSTRZ' : 'INFO ';
      out.write(`\n[${tag}] ${p.id}  ${p.url}\n  → ${p.msg}\n  ✎ ${p.fix}\n`);
    }
  }

  out.write(`\nPodsumowanie: ${errors.length} błędów, ${warns.length} ostrzeżeń.\n`);
  process.exit(errors.length ? 2 : 0);
}
