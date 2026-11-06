# kreatorzywnetrz.pl

Kreatorzy Wnętrz to magazyn o projektowaniu wnętrz, remontach oraz meblach i kuchniach na wymiar.
Strona jest statyczna, zbudowana w Astro 7 i publikowana na GitHub Pages pod własną domeną (`public/CNAME`).
Wpisy leżą w `src/content/wpisy/`; wpis z datą w przyszłości wychodzi przy pierwszej przebudowie po tej dacie.
Budowanie i kontrole: `npm install`, `npm run guard`, `npm run check`, `npm run build`, `npm run guard:build` (wszystko naraz: `npm run verify`).
Przepływ `.github/workflows/build-i-wdrozenie.yml` buduje i wdraża stronę po każdym pushu na `main` oraz trzy razy dziennie.
