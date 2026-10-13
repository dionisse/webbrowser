# Espaces cloud pris en charge

Le principe de Nimbus : **votre espace cloud est la base de données.** Le serveur Nimbus ne conserve
aucun contenu — il transporte des octets chiffrés entre votre navigateur et votre espace.

---

## Arborescence écrite sur votre espace

```
/Nimbus/
├── vault.enc                     coffre chiffré AES-GCM-256 (notes, mots de passe, cartes,
│                                 favoris, historique, groupes d'onglets, réglages)
├── account.json                  en-tête public du profil : identifiant, libellé, teinte,
│                                 sel et itérations KDF, empreinte d'authentification poivrée,
│                                 révision — permet à un autre appareil de *découvrir* le profil
│                                 sans rien pouvoir déchiffrer
├── attachments/<id>              pièces jointes chiffrées
└── snapshots/<revision>.enc      25 derniers instantanés chiffrés, restaurables
```

`account.json` ne contient **ni** clé **ni** coffre : seul le mot de passe maître permet de lire
`vault.enc`.

---

## Matrice des capacités

Valeurs publiées en direct par `GET /api/meta` (champ `providers`) :

| Espace | `id` | Auth | Configuré par défaut | Écriture | Lien de téléchargement direct | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Nimbus Cloud | `local` | aucune | ✅ | ✅ | — | stockage chiffré côté serveur, pour démarrer |
| Google Drive | `google` | OAuth 2 + PKCE | ❌ (clés requises) | ✅ | — | portée `drive.file` |
| Microsoft OneDrive | `onedrive` | OAuth 2 + PKCE | ❌ (clés requises) | ✅ | ✅ | écriture fragmentée au-delà de 4 Mo |
| Yandex Disk | `yandex` | OAuth 2 | ❌ (clés requises) | ✅ | — | portées `disk:all`, `login:email` |
| WebDAV | `webdav` | Basic | ✅ (toujours) | ✅ | — | pCloud, Nextcloud, Infomaniak kDrive, « ou autre » |
| Proton Drive | `proton` | jeton | ❌ | ❌ **lecture/miroir** | ✅ | expérimental — voir §Proton |

Les capacités sont déclaratives (`ProviderDescriptor.capabilities`) : l'interface s'y conforme. Un
espace sans `write` n'est jamais proposé comme hôte d'un nouveau coffre, et le bouton d'écriture est
désactivé avec l'explication associée.

---

## Nimbus Cloud (`local`)

Aucune configuration. Les octets **chiffrés** sont écrits dans `server/data/vaults/<profileId>/…`.
C'est le mode par défaut et la cible de repli des connexions de démonstration.

À utiliser : pour essayer Nimbus, ou si vous hébergez vous-même le serveur et préférez garder les
données sur votre machine.

---

## Google Drive

1. [Console Google Cloud](https://console.cloud.google.com/) → créez un projet, activez **Google Drive API**.
2. *APIs & Services → OAuth consent screen* : type **External**, ajoutez votre compte en test user.
3. *Credentials → Create credentials → OAuth client ID* : type **Web application**.
4. Redirect URI à déclarer :
   ```
   {NIMBUS_PUBLIC_URL}/api/cloud/oauth/google/callback
   ```
5. Renseignez dans `.env` :
   ```
   GOOGLE_CLIENT_ID=…
   GOOGLE_CLIENT_SECRET=…
   ```
6. Redémarrez l'API. Dans Nimbus : *Espace cloud → Google Drive → Connecter*.

Portée demandée : **`drive.file`** — Nimbus ne voit que les fichiers et dossiers qu'il a lui-même
créés. Pas d'accès au reste de votre Drive. C'est la portée la plus restrictive qui permette
l'écriture, et elle évite l'écran d'avertissement Google pour les portées sensibles.

---

## Microsoft OneDrive (« bing »)

1. [Portail Entra](https://entra.microsoft.com/) → *App registrations → New registration*.
2. Plateforme : **Web**. Redirect URI :
   ```
   {NIMBUS_PUBLIC_URL}/api/cloud/oauth/onedrive/callback
   ```
3. *API permissions → Add a permission → Microsoft Graph → Delegated* :
   `Files.ReadWrite.All`, `User.Read`, `offline_access`.
4. *Certificates & secrets → New client secret*.
5. Dans `.env` :
   ```
   ONEDRIVE_CLIENT_ID=…
   ONEDRIVE_CLIENT_SECRET=…
   ```

Particularités : PKCE activé ; écriture **fragmentée** (upload session) au-delà de 4 Mo ;
`downloadUrl()` renvoie un lien pré-authentifié court, seule exception au principe « les jetons ne
quittent jamais le serveur » — ce lien ne donne accès qu'au fichier demandé, pendant quelques minutes.

Le coffre Nimbus apparaît sous `Fichiers/Nimbus/`.

---

## Yandex Disk

1. [oauth.yandex.com](https://oauth.yandex.com/) → *Create new client*.
2. Type : **Web application** ; portées : **Yandex Disk REST API** (`disk:all`) + `login:email`.
3. Callback URI :
   ```
   {NIMBUS_PUBLIC_URL}/api/cloud/oauth/yandex/callback
   ```
4. Dans `.env` :
   ```
   YANDEX_CLIENT_ID=…
   YANDEX_CLIENT_SECRET=…
   ```

`disk:all` est la portée standard de l'API REST Disk ; Yandex ne propose pas d'équivalent strict de
`drive.file`. Si cela vous gêne, créez un compte dédié au coffre Nimbus, ou passez par WebDAV
(Yandex expose un accès DAV).

---

## WebDAV — pCloud, Nextcloud, kDrive, « ou autre »

Toujours disponible, aucune variable d'environnement nécessaire. Les identifiants sont saisis dans
l'interface (*Espace cloud → WebDAV → Connecter*) puis **scellés côté serveur**
(`NIMBUS_SERVER_KEY`, AES-GCM) dans `server/data/connections.json`.

Champs :

| Champ | Exemple |
| --- | --- |
| `url` | `https://webdav.pcloud.com` · `https://cloud.exemple.fr/remote.php/dav/files/marie` |
| `username` | `marie@exemple.fr` |
| `password` | mot de passe ou **mot de passe d'application** (recommandé) |
| `root` | `/Nimbus` (facultatif) |

`WEBDAV_DEFAULT_URL` dans `.env` pré-remplit l'URL pour un déploiement interne.

Conseils :

- Nextcloud / ownCloud : créez un mot de passe d'application (*Paramètres → Sécurité*), jamais votre
  mot de passe de session.
- pCloud : utilisez `webdav.pcloud.com` (ou `ewebdav.pcloud.com` pour l'UE).
- kDrive (Infomaniak) : `https://connect.drive.infomaniak.com/remote.php/dav/` avec un jeton
  d'application.
- Testez avec le bouton **Tester la connexion** : il renvoie l'identité du compte et le quota avant
  toute écriture.

---

## Proton Drive — expérimental, lecture seule

Proton Drive n'expose pas d'API REST publique documentée : le système de fichiers est chiffré côté
client et exige l'authentification **SRP-6a** puis le chiffrement **par paquets** de chaque fichier et
de chaque nom de fichier, avec les clés de dossier dérivées. Réimplémenter cela correctement hors du
SDK officiel est hors du périmètre de ce projet.

Ce que Nimbus fait aujourd'hui avec Proton :

- `list`, `read`, `quota`, `accountInfo`, `downloadUrl` → ✅
- `write` → ❌ (`capabilities.write = false`, marqué `experimental`)
- conséquence dans l'interface : Proton **n'est pas proposé** comme hôte d'un nouveau coffre, et une
  note explicite apparaît sur la carte du fournisseur.

Usage possible : lire/mirorer un coffre existant. Pour écrire, migrez vers Drive, OneDrive, Yandex ou
WebDAV (pCloud et kDrive sont les plus proches de l'esprit Proton).

Configuration (lecture) : `PROTON_CLIENT_ID`, `PROTON_CLIENT_SECRET`, `PROTON_APP_VERSION`, ou un
`accessToken` / `refreshToken` de longue durée saisi dans l'interface.

---

## Connexions de démonstration

Le bouton **Essayer la démo** sur une carte de fournisseur crée une connexion `simulated: true` :
l'interface se comporte exactement comme si l'espace était connecté, mais les octets retombent sur le
client `local`. Utile pour parcourir la migration, le quota, l'arborescence et les instantanés sans
credentials réels. Ces connexions sont étiquetées « démo » partout où elles apparaissent.

---

## Plusieurs espaces et migration

- Plusieurs connexions peuvent coexister (une Google, une WebDAV, …).
- *Espace cloud → basculer* déclenche `POST /api/profiles/:id/move` : le coffre chiffré est lu depuis
  l'espace courant, écrit sur le nouveau, puis `account.json` est mis à jour. **Aucun
  re-chiffrement** : la clé ne change pas, seuls les octets déménagent. La réponse indique
  `movedBytes`.
- `DELETE /api/cloud/connections/:id` retire une connexion ; les identifiants scellés sont détruits.

---

## Instantanés et restauration

Chaque écriture peut produire un instantané chiffré dans `/Nimbus/snapshots/<revision>.enc`
(25 conservés, les plus anciens supprimés). *Espace cloud → Instantanés → Restaurer* appelle
`POST /api/vault/restore` avec le chemin de l'instantané ; le coffre est rechargé et déchiffré
localement. La restauration est une opération en écriture : elle demande confirmation explicite.

---

## Dépannage

| Symptôme | Cause probable | Piste |
| --- | --- | --- |
| « n'est pas configuré sur cette instance » | clés d'environnement absentes | `.env`, puis redémarrage de l'API |
| Le rappel OAuth échoue | `NIMBUS_PUBLIC_URL` ≠ origine réelle, ou URI non déclarée chez le fournisseur | alignez l'URL publique et le redirect URI |
| Connexions perdues après redémarrage | `NIMBUS_SERVER_KEY` absent → clé serveur éphémère | générez une clé stable (`openssl rand -hex 32`) |
| `revision_conflict` (409) | le coffre a été modifié depuis un autre appareil | rechargez le coffre avant d'enregistrer |
| Écriture refusée | espace en lecture seule (Proton) | choisissez un autre espace hôte |
| Erreur TLS vers votre espace | proxy d'entreprise qui ré-écrit le TLS | `NIMBUS_CA_BUNDLE=/chemin/ca.crt` (chargé par `server/scripts/with-ca.mjs`) |
