# World news

PWA di news globali in italiano e inglese, filtrabile per categoria e paese.

## Funzioni

- Fonti primarie con pari importanza: Google News RSS e ANSA.
- Categoria iniziale: Ultim'ora.
- Filtri per categoria, paese, lingua e ricerca libera.
- Paesi inclusi: Italia, Egitto, Abu Dhabi, Stati Uniti e altri mercati principali.
- Widget mobile interno con notizia in evidenza.
- Preferiti salvati sul dispositivo.
- Manifest PWA, icone e service worker per installazione su mobile.
- App non indicizzabile dai motori di ricerca tramite `robots.txt`, meta robots e header `X-Robots-Tag`.
- Pronta per Vercel con funzione serverless `/api/news`.

## Anteprima locale

Avvia:

```bash
npm run preview
```

Apri:

```text
http://localhost:4173
```

## Pubblicazione su Vercel

1. Apri GitHub Desktop.
2. Crea il commit.
3. Premi `Push origin`.
4. Vercel pubblichera automaticamente la nuova versione.

## Note

Google News e ANSA vengono lette insieme. Se una delle due fonti non risponde, l'app mostra comunque le notizie disponibili dall'altra fonte.
