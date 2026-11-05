// astro.config.mjs — kreatorzywnetrz.pl (magazyn o projektowaniu, remontach i meblach na wymiar, GitHub Pages)
// ESM, Astro 7. Wzorce: skill astro-guard.
//
// `site` = adres kanoniczny. Repozytorium ma własną domenę (public/CNAME), więc `base` NIE WYSTĘPUJE.
// Z tej jednej linii biorą się canonical, og:url, sitemapa i adresy w JSON-LD.
// Poza nią adres stoi tylko w public/robots.txt, public/CNAME i public/.well-known/*.json.

import { defineConfig, fontProviders } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, renameSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Bramka przed publikacją szuka DOSŁOWNIE `dist/sitemap.xml`; @astrojs/sitemap daje `sitemap-index.xml` + `sitemap-0.xml`.
// Przy jednej części `sitemap.xml` ma być SAMĄ LISTĄ adresów.
function sitemapJakoPlikSitemapXml() {
  return {
    name: 'sitemap-jako-plik-sitemap-xml',
    hooks: {
      'astro:build:done': ({ dir, logger }) => {
        const katalog = fileURLToPath(dir);
        const cel = join(katalog, 'sitemap.xml');
        const indeks = join(katalog, 'sitemap-index.xml');
        const czesci = readdirSync(katalog)
          .filter((n) => /^sitemap-\d+\.xml$/.test(n))
          .sort();
        if (czesci.length === 1) {
          renameSync(join(katalog, czesci[0]), cel);
          if (existsSync(indeks)) rmSync(indeks);
          // Strona z noindex (pusty dział, /dziekujemy/) nie ma czego szukać w sitemapie: wycinamy jej <url> po treści HTML,
          // więc dział sam wraca do sitemapy przy przebudowie, w której dostał pierwszy opublikowany wpis.
          const mapa = readFileSync(cel, 'utf8');
          const wyciete = [];
          const nowa = mapa.replace(/<url>\s*<loc>([^<]+)<\/loc>[\s\S]*?<\/url>/g, (caly, loc) => {
            const plik = join(katalog, new URL(loc).pathname, 'index.html');
            if (existsSync(plik) && /<meta name="robots" content="noindex/.test(readFileSync(plik, 'utf8'))) {
              wyciete.push(new URL(loc).pathname);
              return '';
            }
            return caly;
          });
          if (wyciete.length) {
            writeFileSync(cel, nowa);
            logger.info(`sitemap.xml bez stron z noindex: ${wyciete.join(' ')}`);
          }
        } else if (existsSync(indeks)) {
          renameSync(indeks, cel);
          logger.warn(`sitemapa ma ${czesci.length} części — sitemap.xml zostaje indeksem, nie listą adresów`);
        }
      },
    },
  };
}

export default defineConfig({
  site: 'https://kreatorzywnetrz.pl',
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory' },
  integrations: [
    sitemap({
      filter: (adres) => !/\/(404|dziekujemy|llms\.txt|rss\.xml)\/?$/.test(new URL(adres).pathname),
    }),
    sitemapJakoPlikSitemapXml(),
  ],
  // `prefetch` świadomie wyłączony (AG004 INFO): przejścia między stronami robi CSS @view-transition, bez JS.

  // Fonts API (Astro 6+, wbudowane — NIE @fontsource, NIE <link> do Google Fonts, AG013/AG028).
  // Provider `google()` pobiera pliki przy budowaniu i serwuje je z własnej domeny (zero zapytań do Google z przeglądarki).
  // `latin-ext` obowiązkowy: bez niego polskie znaki spadają na font systemowy w środku zdania.
  // `fallbacks` w rodzinie kroju: Astro liczy metryki zapasowego fontu względem niego, co trzyma CLS przy 0.
  fonts: [
    {
      provider: fontProviders.google(),
      name: 'DM Serif Display',
      cssVariable: '--font-display',
      fallbacks: ['serif'],
      weights: [400],
      styles: ['normal'],
      subsets: ['latin', 'latin-ext'],
      display: 'swap',
    },
    {
      provider: fontProviders.google(),
      name: 'Hanken Grotesk',
      cssVariable: '--font-sans',
      fallbacks: ['sans-serif'],
      weights: ['300 900'],
      styles: ['normal'],
      subsets: ['latin', 'latin-ext'],
      display: 'swap',
    },
  ],
});
