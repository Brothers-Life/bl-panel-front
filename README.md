# bl-panel-front

Panel staff du serveur Brothers Life. Front statique (HTML/CSS/JS vanilla + Chart.js), aucune étape de build : ouvrir `index.html` ou servir le dossier.

- API : `https://panel-api.webgune.dev/api/*` (constante `API_BASE` dans `app.js`)
- Raccourcis : `⌘K` / `Ctrl K` ou `/` pour la recherche rapide (joueurs + pages)
- Thème clair / sombre et barre latérale repliable, mémorisés dans le navigateur

## Fonctions

- Vue d'ensemble, Économie (dont crypto et comptes sociétés), Joueurs et fiche joueur, Logs, Staff & sécurité
- **Fil en direct** : connexions, morts, chat, erreurs et alertes en temps réel (flux SSE `/api/stream`) ; les logs s'ajoutent aussi en direct
- **Statistiques** : affluence jour × heure, pic de joueurs, disponibilité, métiers, gangs, plus gros tueurs, armes, causes de mort
- **Alertes** : historique (serveur tombé, rafale d'erreurs, anticheat, saut d'argent), état Discord, sauts d'argent suspects, notifications bureau
- **Carte des morts** : carte de chaleur ou points, zones les plus mortelles, détail et captures d'écran
- Export CSV de chaque tableau

Nécessite l'API `bl-panel` à jour pour les fonctions temps réel, statistiques, alertes et carte.

### Fond de carte

Sans image, la carte affiche une grille et les noms de zones. Pour un vrai fond, déposer une carte de GTA V nommée `map.jpg` à la racine et ajuster `IMG_BOUNDS` dans `map.js` (coordonnées du jeu aux bords de l'image).

Pensez à incrémenter le `?v=` de `style.css`, `map.js` et `app.js` dans `index.html` à chaque mise en ligne.
