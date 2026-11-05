// src/content.config.ts — Content Layer (Astro 7). `z` z 'astro/zod'.
//
// wpisy    — nasze wpisy bloga: src/content/wpisy/*.md (pliki z podkreślnikiem na początku są pomijane).
// polecane — zapowiedzi z naszych stron, pisane przez scripts/agreguj-rss.mjs do src/content/polecane/*.md
//            (tylko zapowiedź i link do oryginału; pełnej treści agregator nigdy nie kopiuje).
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

import { DZIALY } from './lib/dzialy';

const KATALOG_ZDJEC = resolve(process.cwd(), 'src/assets/zdjecia');

const wpisy = defineCollection({
  loader: glob({ pattern: '**/[^_]*.md', base: './src/content/wpisy' }),
  schema: z
    .object({
      tytul: z.string().min(5),
      // dział magazynu (projekt-wnetrza, remont, meble-na-wymiar, materialy); brak albo inna wartość zatrzymuje budowanie
      dzial: z.enum(DZIALY),
      // opis meta: 120–160 znaków (kontrola przy budowaniu, żeby wpis z błędem nie wyszedł na stronę)
      opis: z.string().min(120, 'opis krótszy niż 120 znaków').max(160, 'opis dłuższy niż 160 znaków'),
      data: z.coerce.date(),
      // data ostatniej merytorycznej zmiany treści (JSON-LD `dateModified`); bez niej `dateModified` = `data`
      zmieniono: z.coerce.date().optional(),
      // Zdjęcie: każdy wpis ma zdjęcie, pole zostaje technicznie opcjonalne. Bez zdjęcia wpis
      // dostaje planszę działu na karcie i nagłówek bez zdjęcia. Podane: nazwa pliku w src/assets/zdjecia/, brak pliku = błąd.
      zdjecie: z
        .string()
        .refine((n) => existsSync(resolve(KATALOG_ZDJEC, n.split('/').pop() ?? '')), {
          message: 'plik zdjęcia nie istnieje w src/assets/zdjecia/',
        })
        .optional(),
      // alt wymagany, gdy jest zdjęcie (kontrola niżej)
      alt: z.string().min(10).optional(),
      tagi: z.array(z.string()).default([]),
    })
    .refine((w) => !w.zdjecie || !!w.alt, { message: 'wpis ze zdjęciem musi mieć alt (co najmniej 10 znaków)', path: ['alt'] }),
});

const polecane = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/polecane' }),
  schema: z.object({
    tytul: z.string(),
    opis: z.string(),
    data: z.coerce.date(),
    zrodlo: z.string(),
    link: z.url(),
    zdjecie: z.url().optional(),
  }),
});

export const collections = { wpisy, polecane };
