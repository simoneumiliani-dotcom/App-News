# Mondo Chiaro

PWA di news globali in italiano e inglese, filtrabile per categoria e paese.

## Funzioni

- Fonte principale: Webz.io News API Lite.
- Fallback temporaneo: Google News RSS quando la chiave non e configurata o Webz.io non risponde.
- Filtri per categoria, paese, lingua e ricerca libera.
- Widget mobile interno con notizia in evidenza.
- Preferiti salvati sul dispositivo.
- Manifest PWA, icone e service worker per installazione su mobile.
- Pronta per Vercel con funzione serverless `/api/news`.

## Anteprima locale

Se vuoi provare Webz.io anche in locale, crea un file `.env` nella cartella del progetto:

```text
WEBZ_IO_TOKEN=la_tua_chiave_webz_io
```

Poi avvia:

```bash
npm run preview
```

Apri:

```text
http://localhost:4173
```

## Pubblicazione su Vercel

1. Apri GitHub Desktop.
2. Scegli `File` -> `Add local repository`.
3. Seleziona questa cartella: `C:\Users\admin\Documents\App News`.
4. Crea il commit e pubblica il repository su GitHub.
5. Apri Vercel e scegli `Add New Project`.
6. Importa il repository GitHub.
7. Aggiungi `WEBZ_IO_TOKEN` nelle variabili ambiente.
8. Pubblica.

## Variabili ambiente

Per usare Webz.io News API Lite su Vercel aggiungi questa variabile:

```text
WEBZ_IO_TOKEN=la_tua_chiave_webz_io
```

La trovi in Vercel in `Project Settings` -> `Environment Variables`.


Nota: i filtri categoria usano query ampie con fallback automatico quando Webz.io non restituisce risultati.
