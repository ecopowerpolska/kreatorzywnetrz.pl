// Dane strukturalne (schema.org) składane z tych samych tekstów i danych co widoczna strona.
import { t } from './tekst';

const baza = () => new URL('/', import.meta.env.SITE).href.replace(/\/$/, '');
export const adresBezwzgledny = (sciezka: string) => new URL(sciezka, import.meta.env.SITE).href;

export function organizacja(): Record<string, unknown> {
  return {
    '@type': 'Organization',
    '@id': `${baza()}/#organizacja`,
    name: t('marka.nazwa'),
    url: `${baza()}/`,
    logo: { '@type': 'ImageObject', url: `${baza()}/apple-touch-icon.png`, width: 180, height: 180 },
    description: t('marka.opisKrotki'),
    slogan: t('marka.haslo'),
  };
}

export function stronaWww(): Record<string, unknown> {
  return {
    '@type': 'WebSite',
    '@id': `${baza()}/#strona`,
    url: `${baza()}/`,
    name: t('marka.nazwa'),
    description: t('marka.haslo'),
    inLanguage: 'pl-PL',
    publisher: { '@id': `${baza()}/#organizacja` },
  };
}

export function okruszki(pozycje: { nazwa: string; adres: string }[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: pozycje.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: p.nazwa,
      item: adresBezwzgledny(p.adres),
    })),
  };
}
