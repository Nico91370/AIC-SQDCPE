# AIC SQDCPE

Application web d'**Animation à Intervalle Court** sur les six piliers **S**écurité, **Q**ualité, **D**élais, **C**oûts, **P**ersonnel, **E**nvironnement, sur trois niveaux d'instance (N1 équipe, N2 global opération, N3 management site).

Elle remplace le classeur Excel à macros `AIC SQDCPE V1.1.xlsm` et reprend son historique.

## Ce que fait l'application

| Écran | Équivalent Excel | Contenu |
|---|---|---|
| Accueil | Accueil | Une tuile par niveau et service : actions ouvertes, en retard, soldées |
| Écran d'AIC | Tableau | Niveau, service, jour ; lettres SQDCPE colorées selon le jour ; calendrier du mois ; tendance ; saisie du jour (J, J-1, J-2) et commentaires ; « Valider l'AIC » ; fiche ouverte pour chaque écart ; problèmes du jour ; plan d'actions du niveau |
| Plan d'actions | Actions, Fiche | Liste filtrable, fiche problème / action, statut (À faire → En cours → Soldée), PDCA, escalade ▲ / ▼ avec raison et réponse, historique automatique, export CSV |
| Pilotage | Pilotage | Synthèse du mois par niveau, service, thème et origine |
| Paramètres | Indicateurs, Équipe, Paramètres | Indicateurs (cible, sens, actif, graphe, cumul, axes), services et animateurs, listes, jours fériés, rôles des utilisateurs |

Règles reprises des macros : statut OK / NOK selon la cible et le sens (≥ / ≤), lettre rouge dès qu'une mesure du jour est hors cible, état des actions (En retard, Échéance proche…), passage de statut avec PDCA et date de fin, traçage de chaque changement, escalade d'un niveau à l'autre.

Plusieurs sites peuvent cohabiter dans la même base : chaque donnée est rattachée à un site, et le sélecteur de site apparaît dès qu'il y en a deux.

Pas encore repris : les exports PowerPoint (prévus dans une version suivante).

## Technique

- Interface : React + TypeScript (Vite), graphiques Recharts
- Serveur : Node.js 22 + Fastify (`server/`)
- Base : PostgreSQL 16 (schéma dans `server/sql/`, appliqué automatiquement au démarrage)
- Connexion : Microsoft 365 (Entra ID) ou mode test

## Démarrer en local

Prérequis : Node.js 22 et une base PostgreSQL.

```bash
npm install
cp .env.example .env            # puis ajustez DATABASE_URL si besoin
npm run migrate
npm run import:excel -- "chemin/AIC SQDCPE V1.1.xlsm" --site "Site pilote"
npm run dev                     # interface sur http://localhost:5173
```

En mode test (`AUTH_MODE=dev`), on entre simplement son nom, et le code d'accès si `ACCESS_CODE` est défini. Le premier utilisateur connecté devient administrateur. L'import Excel est aussi possible depuis l'application (Paramètres → Import Excel).

Réimporter un fichier pour un site existant : ajoutez `--replace` (efface les données de ce site puis réimporte).

## Serveur de test gratuit (Render.com)

1. Créez un compte sur [render.com](https://render.com) avec « Sign in with GitHub ».
2. **New → Blueprint**, choisissez le dépôt `AIC-SQDCPE`, puis **Apply**. Render lit `render.yaml` et crée l'application et la base.
3. Render demande une valeur pour `ACCESS_CODE` : c'est le code d'accès que les testeurs devront saisir.
4. Une fois le déploiement terminé (5 à 10 minutes), ouvrez l'adresse `https://aic-sqdcpe-xxxx.onrender.com`.
5. Entrez votre nom et le code : le premier connecté devient administrateur et peut importer le fichier Excel depuis l'écran d'accueil.

Limites de l'offre gratuite : mise en veille après 15 minutes sans visite (premier chargement d'environ une minute), base supprimée au bout de 30 jours.

## Mettre en production

### Avec Docker (serveur interne ou Azure)

```bash
docker compose up -d --build
# copiez le fichier Excel dans ./data puis :
docker compose exec app npm run import:excel -- /data/AIC_SQDCPE.xlsm --site "Mon site"
```

L'application écoute sur le port 3000. Sur Azure : une **Azure Web App for Containers** (ou Container Apps) pour l'application et une **Azure Database for PostgreSQL – serveur flexible** pour la base (`DATABASE_SSL=true`).

### Connexion Microsoft 365

1. Dans le portail Azure, **Microsoft Entra ID → Inscriptions d'applications → Nouvelle inscription**.
2. Type de compte : « Comptes dans cet annuaire organisationnel uniquement ».
3. URI de redirection : plateforme **Application monopage (SPA)**, adresse de l'application (ex. `https://aic.mon-entreprise.fr`).
4. Notez l'**ID d'application (client)** et l'**ID de l'annuaire (locataire)**.
5. Variables d'environnement de l'application :

```
AUTH_MODE=entra
ENTRA_TENANT_ID=<ID de l'annuaire>
ENTRA_CLIENT_ID=<ID d'application>
ADMIN_EMAILS=prenom.nom@mon-entreprise.fr
DEFAULT_ROLE=animateur
```

Chaque personne se connecte avec son compte Microsoft. Les rôles (administrateur, animateur, lecteur) se règlent dans **Paramètres → Utilisateurs**.

## Tests

```bash
npm test          # règles métier
npm run build     # vérification des types et compilation de l'interface
```
