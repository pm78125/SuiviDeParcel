# TreeTracker

App de suivi de parcelle (plan, inventaire, dashboard), découpée en modules ES + PWA.

## Lancer en local

Sans build (recommandé pour l’instant) :

```bash
cd SITE_ARBRE
python3 -m http.server 8765
```

Ouvrir http://127.0.0.1:8765/

> Les modules ES et le service worker nécessitent un serveur HTTP (pas `file://`).

## Structure

```
index.html          # coquille HTML
css/main.css        # design system
js/main.js          # entrée + enregistrement PWA
js/app.js           # logique métier
js/lib/             # supabase, utils, offline, icons
icons/              # icônes PWA
sw.js               # service worker (cache shell)
manifest.webmanifest
```

## PWA / hors ligne

- Installable (manifest + icônes)
- Shell mis en cache via `sw.js`
- Snapshot des données dans `localStorage` pour consultation hors ligne (lecture seule ; les écritures restent bloquées hors ligne)

## Vite (optionnel)

Si Node est disponible :

```bash
npm install
npm run dev
```

## Données

Backend Supabase (arbres, suivis, catégories, storage photos/carte).
