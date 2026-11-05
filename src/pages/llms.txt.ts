// /llms.txt — streszczenie strony dla asystentów AI (llmstxt.org), składane z tych samych tekstów co strona (teksty.json).
// Bez daty budowania: zmieniałaby się przy każdej przebudowie, choć treść stoi. Bez danych wydawcy.
import type { APIRoute } from 'astro';
import { t } from '../lib/tekst';
import { opublikowane, adresWpisu, bezHtml } from '../lib/wpisy';
import { wszystkiePolecane, polecaneRozne, NA_ZRODLO_LLMS } from '../lib/polecane';
import { DZIALY, adresDzialu, nazwaDzialu } from '../lib/dzialy';

export const GET: APIRoute = async () => {
  const baza = new URL('/', import.meta.env.SITE).href.replace(/\/$/, '');
  const wpisy = await opublikowane();
  const zapowiedzi = polecaneRozne(await wszystkiePolecane(), NA_ZRODLO_LLMS).slice(0, 12);
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
    ...dzialy.map(({ d }) => `- [${nazwaDzialu(d)}](${baza}${adresDzialu(d)}): ${bezHtml(t(`dzialy.${d}.metaOpis`))}`),
    `- [${t('blog.tytul')}](${baza}/blog/): ${bezHtml(t('blog.opis'))}`,
    `- [${t('polecamy.tytul')}](${baza}/polecamy/): ${bezHtml(t('polecamy.opis'))}`,
    `- [${t('o-nas.tytul')}](${baza}/o-nas/): ${bezHtml(t('o-nas.opis'))}`,
    `- [${t('kontakt.tytul')}](${baza}/kontakt/): ${bezHtml(t('kontakt.opis'))}`,
    `- [${t('polityka.tytul')}](${baza}/polityka-prywatnosci/): ${bezHtml(t('polityka.opis'))}`,
    `- [${t('stopka.rss')}](${baza}/rss.xml)`,
    '',
    ...dzialy.flatMap(({ d, wpisy: lista }) => [
      `## ${nazwaDzialu(d)}`,
      ...lista.map((w) => `- [${w.data.tytul}](${baza}${adresWpisu(w.id)}): ${bezHtml(w.data.opis)}`),
      '',
    ]),
    ...(zapowiedzi.length > 0
      ? [`## ${t('polecamy.zapowiedziNaglowek')}`, ...zapowiedzi.map((w) => `- [${w.data.tytul}](${w.data.link}): ${w.data.zrodlo}`), '']
      : []),
  ];
  return new Response(linie.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
