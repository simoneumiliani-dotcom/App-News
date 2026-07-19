# World news

PWA di news globali in italiano, filtrabile solo per categoria.

## Funzioni

- Fonte primaria: ANSA RSS.
- Fonte secondaria: NewsData.io, usata quando ANSA restituisce pochi risultati.
- Categoria iniziale: Ultim'ora.
- Interfaccia semplificata: resta solo il filtro Categoria.
- Cache lato Vercel di 15 minuti per ridurre chiamate e consumo crediti.
- Preferiti salvati sul dispositivo.
- Manifest PWA, icone e service worker per installazione su mobile.
- App non indicizzabile dai motori di ricerca tramite `robots.txt`, meta robots e header `X-Robots-Tag`.
- Pronta per Vercel con funzione serverless `/api/news`.

## Variabili Ambiente

NewsData.io e opzionale ma consigliato come fonte secondaria. Su Vercel aggiungi:

```text
NEWSDATA_API_KEY=la_tua_chiave_newsdata
```

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
