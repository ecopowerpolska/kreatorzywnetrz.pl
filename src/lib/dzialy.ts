// Działy magazynu: slug = adres strony działu (/projekt-wnetrza/ …) i wartość pola `dzial` we frontmatterze wpisu.
// Kolejność = kolejność na stronie głównej. Nazwy i wstępy żyją w teksty.json (`dzialy.<slug>.*`).
import { t } from './tekst';

export const DZIALY = ['projekt-wnetrza', 'remont', 'meble-na-wymiar', 'materialy'] as const;
export type Dzial = (typeof DZIALY)[number];

// Nazwy wyświetlane: Projekt wnętrza, Remont, Meble i kuchnie, Materiały (teksty.json, dzialy.<slug>.nazwa).
export const adresDzialu = (slug: Dzial) => `/${slug}/`;
export const nazwaDzialu = (slug: Dzial) => t(`dzialy.${slug}.nazwa`);
