// /rss.xml — kanał RSS 2.0 naszych wpisów (bez pakietu @astrojs/rss). Zapowiedzi z innych stron do kanału NIE wchodzą.
// Pierwsza <category> wpisu = nazwa działu, dalej tagi.
import type { APIRoute } from 'astro';
import { t } from '../lib/tekst';
import { opublikowane, adresWpisu } from '../lib/wpisy';
import { nazwaDzialu } from '../lib/dzialy';

const xml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export const GET: APIRoute = async () => {
  const baza = new URL('/', import.meta.env.SITE).href.replace(/\/$/, '');
  const wpisy = (await opublikowane()).slice(0, 50);
  const elementy = wpisy
    .map((w) => {
      const adres = `${baza}${adresWpisu(w.id)}`;
      return [
        '    <item>',
        `      <title>${xml(w.data.tytul)}</title>`,
        `      <link>${adres}</link>`,
        `      <guid isPermaLink="true">${adres}</guid>`,
        `      <pubDate>${w.data.data.toUTCString()}</pubDate>`,
        `      <description>${xml(w.data.opis)}</description>`,
        `      <category>${xml(nazwaDzialu(w.data.dzial))}</category>`,
        ...w.data.tagi.map((tag) => `      <category>${xml(tag)}</category>`),
        '    </item>',
      ].join('\n');
    })
    .join('\n');

  const tresc = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xml(t('marka.nazwa'))}</title>
    <link>${baza}/</link>
    <atom:link href="${baza}/rss.xml" rel="self" type="application/rss+xml" />
    <description>${xml(t('marka.haslo'))}</description>
    <language>pl-PL</language>
${elementy}
  </channel>
</rss>
`;
  return new Response(tresc, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
};
