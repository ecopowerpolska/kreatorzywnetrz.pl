// /llms.txt — streszczenie strony dla asystentów AI (llmstxt.org), składane z tych samych danych co strona.
// Bez daty budowania: zmieniałaby się przy każdej przebudowie, choć treść stoi.
import type { APIRoute } from 'astro';
import { t } from '../lib/tekst';
import { opublikowane, polecaneRozne, adresWpisu, bezHtml } from '../lib/wpisy';
import { DZIALY, adresDzialu, nazwaDzialu } from '../lib/dzialy';

export const GET: APIRoute = async () => {
  const baza = new URL('/', import.meta.env.SITE).href.replace(/\/$/, '');
  const wpisy = await opublikowane();
  const zaplowki = (await polecaneRozne(3)).slice(0, 12);
  // Działy z wpisami; pusty dział (noindex) nie wchodzi ani do listy stron, ani do sekcji wpisów.
  const dzialy = DZIALY.map((d) => ({ d, wpisy: wpisy.filter((w) => w.data.dzial === d) })).filter((x) => x.wpisy.length > 0);
  const linie = [
    `# ${t('marka.nazwa')}`,
    '',
    `> ${t('marka.haslo')}`,
    '',
    bezHtml(t('marka.opisKrotki')),
    '',
    '## Strony',
    ...dzialy.map(({ d }) => `- [${nazwaDzialu(d)}](${baza}${adresDzialu(d)}): ${bezHtml(t(`dzialy.${d}.opisMeta`))}`),
    `- [Wszystkie wpisy](${baza}/blog/): lista wpisów ze wszystkich działów, od najnowszego`,
    `- [${t('polecamy.h1')}](${baza}/polecamy/): ${bezHtml(t('polecamy.opisMeta'))}`,
    `- [O nas](${baza}/o-nas/): kim jesteśmy`,
    `- [Polityka prywatności](${baza}/polityka-prywatnosci/): bez własnych cookies i bez analityki`,
    `- [Kanał RSS](${baza}/rss.xml): nowe wpisy`,
    '',
    ...dzialy.flatMap(({ d, wpisy: lista }) => [
      `## ${nazwaDzialu(d)}`,
      ...lista.map((w) => `- [${w.data.tytul}](${baza}${adresWpisu(w.id)}): ${bezHtml(w.data.opis)}`),
      '',
    ]),
    `## ${t('polecamy.naglowekZapowiedzi')}`,
    ...zaplowki.map((w) => `- [${w.data.tytul}](${w.data.link}): ${w.data.zrodlo}`),
    '',
  ];
  return new Response(linie.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
