# Équation Hi-Lo · 20 ou 1 ?

Jeu multijoueur en ligne de calcul et de bluff, à jouer entre amis sur téléphone ou ordinateur.
Inspiré de l'épreuve *Equation High-Low* de l'émission *The Devil's Plan* (projet fan non officiel).

**Jouer : https://equation-hilo.onrender.com**

## Le jeu en bref

- Chaque joueur reçoit 4 chiffres (dont 1 caché) et les opérateurs **+ − ÷**. Un **×** remplace le + ou le −, une **√** s'applique à un chiffre.
- Il range toutes ses cartes en une équation pour approcher **20 (High)** ou **1 (Low)**. × et ÷ passent avant + et −.
- Deux tours d'enchères à la poker (plafonnés au plus petit tapis), puis déclaration secrète : High, Low ou **Swing** (les deux, tout ou rien).
- Le plus proche de 20 et le plus proche de 1 se partagent le pot. Égalités : plus grosse carte (High) ou plus petite (Low), puis couleur (or > argent > bronze > noir).

## Fonctionnalités

- Tables privées avec code à 4 lettres, lien d'invitation, partage natif et QR code
- 2 à 8 joueurs, bots pour compléter ou s'entraîner seul
- Règles illustrées + bac à sable pour s'entraîner aux équations
- Après chaque manche : la meilleure équation que tu pouvais faire
- Reconnexion automatique (rafraîchir la page ne fait pas perdre sa place), spectateurs
- Réglages : jetons de départ, temps de réflexion, dernier survivant ou nombre de manches
- Sons, vibrations, réactions emoji, interface pensée d'abord pour le téléphone

## Développement

```bash
npm install
npm run dev:server   # serveur temps réel sur http://localhost:3001
npm run dev:client   # interface sur http://localhost:5173
npm test             # moteur, résolution des manches, centaines de parties simulées
npm run e2e          # partie complète avec de vrais clients connectés (serveur lancé)
```

## Architecture

- `shared/` : cartes, évaluation et solveur d'équations, résolution High/Low/Swing, types du protocole
- `server/` : Node + Express + Socket.IO ; l'état de chaque table vit en mémoire, le serveur fait autorité (les cartes cachées ne quittent jamais le serveur avant la révélation)
- `client/` : React + Vite + Framer Motion

Hébergement sur Render : un service web (serveur temps réel, `npm ci && npm run build`, `npm start`)
et un site statique (`npm ci && npm run build:client`, dossier `dist/client`, variable `VITE_SERVER_URL`).
