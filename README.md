# bl-panel-front

Panel staff du serveur Brothers Life : affichage des données et connexion Discord.
Les données sont stockées par **bl-panel-api** ; le panel les lui demande avec une clé partagée, seulement pour les personnes connectées.

```
navigateur ──(cookie de session)──► panel (server.js) ──(X-Panel-Key)──► bl-panel-api ◄── bl_telemetry (FiveM)
```

## Lancer

Node 20+, aucune dépendance :

```bash
cp .env.example .env   # puis remplir
npm start              # ou : node server.js
```

Sur Railway (comme l'API) : créer un service depuis ce dépôt, mettre les variables de `.env.example` dans ses réglages et faire pointer `panel-front.webgune.dev` dessus. Le panel ne peut plus être servi comme simple site statique : c'est `server.js` qui gère la connexion et relaie les données.

## Connexion Discord

1. Créer une application sur https://discord.com/developers/applications.
2. Dans **OAuth2**, copier le *Client ID* et le *Client Secret* dans `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`.
3. Dans **OAuth2 → Redirects**, ajouter exactement `DISCORD_REDIRECT_URI` (`https://panel-front.webgune.dev/auth/discord/callback`).
4. Mettre les ID Discord des webmasters dans `WEBMASTER_DISCORD_IDS` et une longue chaîne aléatoire dans `SESSION_SECRET`.
5. Mettre la même `PANEL_API_KEY` ici et dans le `.env` de l'API.
6. (Facultatif) `DISCORD_GUILD_ID` + `DISCORD_ALLOWED_ROLE_IDS` pour laisser entrer automatiquement les rôles staff.

Qui peut entrer : les webmasters, les personnes autorisées depuis la page **Accès au panel**, et (si configuré) les membres du serveur Discord avec un rôle autorisé. Un webmaster peut retirer l'accès à n'importe qui (effet en 30 s max). Tant qu'une variable Discord obligatoire manque, la connexion est désactivée (message au démarrage).
- Raccourcis : `⌘K` / `Ctrl K` ou `/` pour la recherche rapide (joueurs + pages)
- Thème clair / sombre et barre latérale repliable, mémorisés dans le navigateur

## Fonctions

- Vue d'ensemble, Économie (dont crypto et comptes sociétés), Joueurs et fiche joueur, Logs, Staff & sécurité
- **Fil en direct** : connexions, morts, chat, erreurs et alertes en temps réel (flux SSE `/api/stream`) ; les logs s'ajoutent aussi en direct
- **Statistiques** : affluence jour × heure, pic de joueurs, disponibilité, métiers, gangs, plus gros tueurs, armes, causes de mort
- **Alertes** : historique (serveur tombé, rafale d'erreurs, anticheat, saut d'argent), état Discord, sauts d'argent suspects, notifications bureau
- **Carte des morts** : carte de chaleur ou points, zones les plus mortelles, détail et captures d'écran
- Export CSV de chaque tableau


### Fond de carte

Sans image, la carte affiche une grille et les noms de zones. Pour un vrai fond, déposer une carte de GTA V nommée `map.jpg` à la racine et ajuster `IMG_BOUNDS` dans `map.js` (coordonnées du jeu aux bords de l'image).

Pensez à incrémenter le `?v=` de `style.css`, `map.js` et `app.js` dans `index.html` à chaque mise en ligne.

Nécessite l'API `bl-panel-api` à jour.
