# Nimbus — le navigateur 100 % cloud, coffre zero-knowledge

**Nimbus** est un navigateur sécurisé qui ne s'exécute jamais sur votre machine : le rendu des pages
a lieu dans le cloud, vos données (notes, mots de passe, cartes bancaires, favoris, historique,
réglages) sont chiffrées **dans votre navigateur** puis stockées sur **votre propre espace cloud**
(Google Drive, Proton Drive, Yandex Disk, Microsoft OneDrive, ou tout serveur WebDAV).

Rien ne reste sur l'ordinateur : ni cache, ni cookies de sites, ni fichiers. Le seul moment où un
octet touche votre disque, c'est quand **vous** cliquez sur « Récupérer sur cet appareil » dans le
gestionnaire de téléchargements.

Un mot de passe maître est exigé à chaque ouverture de session. Après 15 minutes d'inactivité (ou dès
que vous fermez l'onglet), la clé de chiffrement est détruite en mémoire et tout l'état éphémère est
effacé.

> Interface bilingue **FR / EN**, design inspiré de *Hume — Mobile App Design for Smart Home*
> (Phenomenon Studio) : surfaces sombres et chaudes, cartes par section, puces d'état, grands rayons,
> mouvements calmes. Deux facteurs de forme partagent le même système de design : une **coque
> navigateur desktop** et un **compagnon mobile (PWA)**.

---

## Sommaire

- [Démarrage rapide](#démarrage-rapide)
- [Ce que vous obtenez](#ce-que-vous-obtenez)
- [Architecture](#architecture)
- [Modèle de sécurité](#modèle-de-sécurité)
- [Espaces cloud pris en charge](#espaces-cloud-pris-en-charge)
- [API HTTP](#api-http)
- [Limites assumées](#limites-assumées)
- [Scripts](#scripts)
- [Documentation](#documentation)

---

## Démarrage rapide

```bash
npm install                 # workspaces npm : server + web
cp .env.example .env        # tout est optionnel : sans clé, mode « Nimbus Cloud » local
npm run dev                 # API sur :8787, interface sur :5173 (proxy /api)
```

Ouvrez `http://localhost:5173`, créez un profil (nom, couleur, mot de passe maître, espace cloud),
puis naviguez. Pour une production mono-process :

```bash
npm run build && npm start   # le serveur Express sert aussi web/dist
```

**Démo immédiate.** Le moteur cloud sert cinq sites de démonstration qui exercent réellement la
réécriture HTML/CSS, le blocage de traqueurs, le mode lecture et le garde anti-SSRF :

Chacune de ces pages embarque volontairement **6 traqueurs** et un bandeau de consentement : de quoi
vérifier que le blocage et le masquage sont réellement actifs (le compteur de la barre d'état bouge).

| URL              | Ce qu'elle démontre                                                          |
| ---------------- | ---------------------------------------------------------------------------- |
| `nimbus://index` | sommaire des quatre pages + réécriture de centaines d'URL, shim `postMessage` |
| `nimbus://news`  | article long → **mode lecture** (extraction, typographie, temps de lecture)   |
| `nimbus://shop`  | catalogue + **formulaire POST** remonté à la coque puis rejoué par le moteur  |
| `nimbus://mail`  | boîte de réception + formulaire de connexion → **autoremplissage** du coffre  |
| `nimbus://docs`  | contenu technique dense, ancres et code → navigation et bandeaux masqués      |

---

## Ce que vous obtenez

**Navigation**

- Multi-onglets avec **groupes d'onglets** colorés, onglets épinglés, réorganisation par glisser-déposer,
  duplication, « fermer les autres ».
- **Écran partagé** (split view) : deux pages côte à côte, chacune dans son cadre isolé.
- Barre d'adresse avec suggestions issues des favoris, de l'historique **et** du coffre, six moteurs de
  recherche au choix.
- **Mode lecture** : extraction du contenu utile, typographie apaisée, taille de texte réglable.
- Historique et favoris chiffrés, synchronisés sur votre espace.
- Blocage des traqueurs et masquage des bandeaux (consentement, newsletters, interstitiels), par onglet
  ou globalement.
- **Téléchargements mis en scène dans le cloud** : le fichier reste en mémoire serveur, remis une seule
  fois à votre appareil sur clic explicite, puis oublié.

**Coffre**

- **Notes** épinglables, étiquetées, huit teintes.
- **Mots de passe** : générateur paramétrable, indicateur de robustesse (entropie réelle), détection des
  mots de passe faibles / réutilisés / anciens, **TOTP** en direct, compteur d'usage.
- **Cartes bancaires** : tuiles visuelles par réseau, validation Luhn, copie du numéro ou du CVC,
  masquage par défaut.
- Instantanés chiffrés (25 révisions conservées) et restauration en un clic.
- Export / import d'une sauvegarde `.nimbus` chiffrée ; changement du mot de passe maître (rekey) sans
  perdre les données.

**Espace cloud**

- Connexion à plusieurs espaces, test de connexion, quota, arborescence des fichiers du coffre,
  **migration du coffre d'un espace à l'autre** (re-chiffrement inchangé : seuls les octets déménagent).

---

## Architecture

```
webbrowser/
├── server/                     Express 4 + TypeScript — le moteur cloud
│   └── src/
│       ├── browse/             engine · rewrite · blocklist · cache · downloads · demo-sites
│       ├── providers/          google-drive · proton-drive · yandex-disk · onedrive · webdav · local
│       ├── vault/              store zero-knowledge (lecture/écriture sur l'espace de l'utilisateur)
│       ├── session/            sessions en mémoire, jeton de rendu, verrouillage destructif
│       ├── crypto/             enveloppe AES-GCM pour les identifiants de fournisseurs
│       └── routes/             profiles · vault · cloud · browse · meta
└── web/                        React 18 + Vite 6 + TypeScript — la coque
    └── src/
        ├── design/             tokens.css (palette Hume) · ui.css · composants · theme.ts
        ├── features/           lock · shell · browser · notes · passwords · cards · cloud
        │                       privacy · settings · bookmarks · history · downloads
        ├── state/              ui · session · vault · browser · cloud (zustand, graphe acyclique)
        ├── lib/                api · crypto (WebCrypto) · types · bus
        └── i18n/               fr · en
```

Le serveur **ne déchiffre jamais** le coffre : il transporte des octets chiffrés entre le navigateur et
votre espace cloud. Le rendu des pages est fait côté serveur (fetch + réécriture HTML/CSS), puis livré
dans un `<iframe sandbox>` **sans** `allow-same-origin`.

Détails : [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Modèle de sécurité

| Élément | Traitement |
| --- | --- |
| Mot de passe maître | Jamais envoyé. Dérivé localement : `PBKDF2-SHA256`, **310 000** itérations. |
| Clé de chiffrement | `AES-GCM-256`, uniquement en mémoire, détruite au verrouillage. |
| Ce que voit le serveur | Un `authHash` ; il stocke `SHA256(authHash ‖ HMAC(serverKey, pepper))`. |
| Coffre | Chiffré de bout en bout, écrit sur **votre** espace (`/Nimbus/vault.enc`). |
| Pages visitées | Rendues dans un cadre à origine opaque : pas d'accès au DOM, au stockage ni aux cookies de la coque. |
| Jeton de rendu | Jeton de session transmis dans l'URL du cadre (le cookie `SameSite=Lax` n'y est pas envoyé) ; tué au verrouillage. |
| Garde anti-SSRF | Hôtes privés, loopback et métadonnées cloud refusés ; le moteur ne rend jamais `169.254.169.254`. |
| Verrouillage | Destructif : cache de rendu, téléchargements en attente et jeton sont effacés côté serveur. |

Détails et menaces couvertes : [`docs/SECURITY.md`](docs/SECURITY.md).

---

## Espaces cloud pris en charge

| Espace | Statut | Écriture | Configuration |
| --- | --- | --- | --- |
| **Nimbus Cloud** (`local`) | prêt à l'emploi | ✅ | aucune |
| **Google Drive** | OAuth 2 + PKCE, scope `drive.file` | ✅ | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` |
| **Microsoft OneDrive** (« bing ») | OAuth 2 + PKCE, `Files.ReadWrite.All` | ✅ | `ONEDRIVE_CLIENT_ID` / `ONEDRIVE_CLIENT_SECRET` |
| **Yandex Disk** | OAuth 2, `disk:all` | ✅ | `YANDEX_CLIENT_ID` / `YANDEX_CLIENT_SECRET` |
| **WebDAV** (pCloud, Nextcloud, kDrive, « ou autre ») | Basic auth | ✅ | saisi dans l'interface (chiffré au repos) |
| **Proton Drive** | expérimental | ❌ lecture/miroir | jeton d'accès ; l'écriture exige le SDK officiel (SRP-6a + chiffrement par paquets) |

Détails, URLs de redirection et mise en place : [`docs/CLOUD-PROVIDERS.md`](docs/CLOUD-PROVIDERS.md).

---

## API HTTP

Réponse enveloppée : `{ "ok": true, "data": … }` ou `{ "ok": false, "error": { code, message } }`.

```
GET    /api/meta                       capacités, fournisseurs, état de session, santé
GET    /api/profiles                   profils découverts
POST   /api/profiles                   création (kdf, authHash, coffre chiffré)
POST   /api/profiles/unlock            déverrouillage (8 tentatives → 15 min de blocage)
POST   /api/profiles/lock              verrouillage destructif
PUT    /api/profiles/:id/rekey         nouveau mot de passe maître
POST   /api/profiles/:id/move          migration du coffre vers un autre espace
GET    /api/vault  ·  PUT /api/vault   lecture / écriture (garde baseRevision)
GET    /api/vault/snapshots · /restore instantanés chiffrés
GET    /api/cloud/providers · /connections · /status
POST   /api/cloud/oauth/:provider/start · /callback
GET    /api/browse/view?u=…&t=…        rendu d'un document (HTML réécrit)
GET    /api/browse/asset?u=…           ressources brutes (CSS/JS/images)
GET    /api/browse/reader?u=…          extraction en mode lecture
GET    /api/browse/blocked?u=…         GIF 1×1 pour les traqueurs coupés
POST   /api/browse/download            mise en scène d'un fichier
GET    /api/browse/downloads/:id       remise unique à l'appareil
GET    /api/browse/stats               cache, octets, hôtes coupés
```

---

## Limites assumées

1. **Le moteur ne réécrit pas le JavaScript des pages.** Les URLs de traqueurs appelées par un script
   inline peuvent passer ; le mode lecture reste la parade. Aucun site « applicatif » lourd (Gmail,
   Figma…) ne s'exécutera : le rendu est un proxy HTML/CSS, pas un navigateur distant complet.
2. **Proton Drive en lecture seule** côté Nimbus (voir ci-dessus).
3. **Les jetons de fournisseurs restent côté serveur**, chiffrés par `NIMBUS_SERVER_KEY`. Sans cette
   variable, la clé est éphémère et les connexions ne survivent pas à un redémarrage.
4. **Sessions en mémoire** : un redémarrage du serveur impose de se reconnecter.
5. L'autoremplissage d'un formulaire ne peut pas écrire dans un cadre à origine opaque : Nimbus copie
   l'identifiant retenu et marque l'entrée comme utilisée.

---

## Scripts

| Commande | Effet |
| --- | --- |
| `npm run dev` | API (tsx watch) + interface (vite) en parallèle |
| `npm run dev:server` / `dev:web` | l'un ou l'autre |
| `npm run build` | `tsc` serveur + `vite build` |
| `npm start` | serveur de production (sert aussi `web/dist`) |
| `npm run typecheck` | vérification des deux workspaces |
| `npm run clean` | supprime `node_modules` et `dist` |

---

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — flux de données, stores, système de design, moteurs de rendu.
- [`docs/SECURITY.md`](docs/SECURITY.md) — modèle de menace, crypto, isolation des cadres, cycle de vie.
- [`docs/CLOUD-PROVIDERS.md`](docs/CLOUD-PROVIDERS.md) — configuration de chaque espace, arborescence du coffre.
- [`.env.example`](.env.example) — toutes les variables d'environnement, commentées.
